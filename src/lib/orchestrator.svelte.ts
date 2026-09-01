import { SvelteMap } from 'svelte/reactivity';
import type { Node } from '@xyflow/svelte';
import type { Vivari } from '@vivari/core';
import { toast } from 'svelte-sonner';
import { anyStoredDataNodes, GraphState, nodePorts } from './graph-state.svelte';
import { createContext } from './context';
import { messageOf } from './errors';
import {
	getResourceDefinition,
	type Instance,
	type ResourceStatus,
	type Upstream
} from './resources';
import { ResourceController, type ControllerServices } from './resource-controller.svelte';
import type { MetricStore, OutputLine, ResourceEvent } from './resource-log.svelte';
import { getContainer, removeNodeFiles, shutdownContainer } from './container';

// IANA registered port range
const MIN_PORT = 1024;
const MAX_PORT = 49151;

// How long a boot may take before the wait is named rather than left as a bare spinner
const SLOW_BOOT_MS = 1500;

// Registry of one ResourceController per node, plus the cross-node concerns the
// controllers share: the container, port uniqueness and dependent wiring
export class Orchestrator {
	#graphState: GraphState;
	#controllers = new SvelteMap<string, ResourceController>();
	#containerPromise: Promise<Vivari> | undefined;
	#containerReady = $state(false);
	#containerError = $state<string | undefined>();
	#slowBoot = $state(false);
	#slowBootTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(graphState: GraphState) {
		this.#graphState = graphState;
		this.reconcileAllReservations();
	}

	get containerReady(): boolean {
		return this.#containerReady;
	}

	get containerError(): string | undefined {
		return this.#containerError;
	}

	// A slow boot is almost always a database restoring its files, so a canvas with one can say so
	get restoringStoredData(): boolean {
		return this.#slowBoot && !this.#containerReady && anyStoredDataNodes();
	}

	warmUp() {
		// No node owns this failure, and nothing can run without it, so it is said once here
		// rather than waiting for the first start to report it as a failed prepare
		void this.#getContainer().catch(() => toast.error('Container failed to boot'));
	}

	reset() {
		for (const controller of this.#controllers.values()) controller.abandon();
		this.#controllers.clear();
		this.#containerPromise = undefined;
		this.#containerReady = false;
		this.#containerError = undefined;
		this.#endBootWatch();
		shutdownContainer();
		this.warmUp();
	}

	getStatus(nodeId: string): ResourceStatus {
		return this.#controllers.get(nodeId)?.status ?? 'stopped';
	}

	getInstances(nodeId: string): Instance[] {
		return this.#controllers.get(nodeId)?.instances ?? [];
	}

	// A port is reserved before anything runs on it, and keeps its reservation while whatever
	// was there is down, so a port with no instance behind it is stopped rather than missing
	getInstanceStatus(nodeId: string, port: number): ResourceStatus {
		return (
			this.getInstances(nodeId).find((instance) => instance.port === port)?.status ?? 'stopped'
		);
	}

	getUpCount(nodeId: string): number {
		return this.#controllers.get(nodeId)?.upCount ?? 0;
	}

	getConfiguredCount(nodeId: string): number {
		const node = this.#graphState.getNode(nodeId);
		return node ? getResourceDefinition(node.type).instanceCount(node) : 0;
	}

	// Reserved before anything runs, so a dependent can be wired to a target not yet started
	getReservedPorts(nodeId: string): readonly number[] {
		const node = this.#graphState.getNode(nodeId);
		// A deleted node's ports go with it; its winding-down instances hold what they have
		if (!node) return [];
		return nodePorts(node);
	}

	// Rebuilt per call rather than cached, so a definition always reads current edges
	getUpstreams(nodeId: string): readonly Upstream[] {
		return this.#graphState.edges
			.filter((edge) => edge.source === nodeId)
			.flatMap((edge) => {
				const node = this.#graphState.getNode(edge.target);
				return node
					? [
							{
								node,
								instances: this.getInstances(edge.target),
								reservedPorts: this.getReservedPorts(edge.target)
							}
						]
					: [];
			});
	}

	getEvents(nodeId: string): ResourceEvent[] {
		return this.#controllers.get(nodeId)?.log.events ?? [];
	}

	getOutput(nodeId: string): OutputLine[] {
		return this.#controllers.get(nodeId)?.log.output ?? [];
	}

	getMetrics(nodeId: string): MetricStore {
		return this.#controllers.get(nodeId)?.log.metrics ?? {};
	}

	getRestarts(nodeId: string): number {
		return this.#controllers.get(nodeId)?.restarts ?? 0;
	}

	getRestartsPaused(nodeId: string): boolean {
		return this.#controllers.get(nodeId)?.restartsPaused ?? false;
	}

	getRestartPending(nodeId: string): boolean {
		return this.#controllers.get(nodeId)?.restartPending ?? false;
	}

	// No controller means the node has never been started, so starting is what it needs
	// and stopping is meaningless
	canStart(nodeId: string): boolean {
		if (!this.#graphState.getNode(nodeId)) return false;
		return this.#controllers.get(nodeId)?.canStart ?? true;
	}

	canStop(nodeId: string): boolean {
		return this.#controllers.get(nodeId)?.canStop ?? false;
	}

	start(nodeId: string) {
		const node = this.#graphState.getNode(nodeId);
		if (!node) return;
		this.#controllerFor(node).start();
	}

	stop(nodeId: string) {
		this.#controllers.get(nodeId)?.stop();
	}

	startAll() {
		for (const node of this.#graphState.nodes) this.start(node.id);
	}

	stopAll() {
		for (const node of this.#graphState.nodes) this.stop(node.id);
	}

	// Called once a node is gone from the graph. The controller winds down off its own state
	// and removes the files when it unregisters; a node that never ran has none to wait for
	remove(nodeId: string) {
		const controller = this.#controllers.get(nodeId);
		if (controller) controller.forget();
		else void removeNodeFiles(nodeId);
	}

	// Config or edges changed: resize the reservation (even while stopped) and reconcile
	refresh(nodeId: string) {
		this.#reconcileReservations(nodeId);
		this.#controllers.get(nodeId)?.schedule();
	}

	// Establishes the ports-match-configured invariant across a freshly loaded graph
	reconcileAllReservations() {
		for (const id of this.#graphState.nodes.map((node) => node.id)) {
			this.#reconcileReservations(id);
		}
	}

	#controllerFor(node: Node): ResourceController {
		let controller = this.#controllers.get(node.id);
		if (!controller) {
			controller = new ResourceController(
				node.id,
				getResourceDefinition(node.type),
				this.#servicesFor(node.id)
			);
			this.#controllers.set(node.id, controller);
		}
		return controller;
	}

	#servicesFor(nodeId: string): ControllerServices {
		return {
			getNode: () => this.#graphState.getNode(nodeId),
			getContainer: () => this.#getContainer(),
			takePort: () => this.#takePort(nodeId),
			reconcileReservations: () => this.#reconcileReservations(nodeId),
			getUpstreams: () => this.getUpstreams(nodeId),
			scheduleDependents: () => this.#scheduleDependents(nodeId),
			unregister: () => {
				this.#controllers.delete(nodeId);
				// Only reached after the node is deleted and its last instance is gone
				void removeNodeFiles(nodeId);
			}
		};
	}

	#getContainer() {
		this.#slowBootTimer ??= setTimeout(() => (this.#slowBoot = true), SLOW_BOOT_MS);
		this.#containerPromise ??= getContainer().then(
			(container) => {
				container.on('server-ready', (port, url) => {
					for (const controller of this.#controllers.values()) {
						if (controller.onServerReady(port, url)) return;
					}
				});
				this.#containerReady = true;
				this.#endBootWatch();
				return container;
			},
			(error) => {
				// Recorded wherever the boot was triggered from, then rethrown so whoever asked
				// still fails and logs it against their own node
				this.#containerError = messageOf(error);
				this.#endBootWatch();
				throw error;
			}
		);
		return this.#containerPromise;
	}

	#endBootWatch() {
		clearTimeout(this.#slowBootTimer);
		this.#slowBootTimer = undefined;
		this.#slowBoot = false;
	}

	// Re-fits the reservation to the configured count; called from event sites, never reads
	#reconcileReservations(nodeId: string) {
		const node = this.#graphState.getNode(nodeId);
		if (!node) return;

		const reserved = nodePorts(node);
		const configured = this.getConfiguredCount(nodeId);

		// A scale-down drops the ports past the new count, except any an instance is still
		// winding down on: those go once it is gone, so nothing is reserved twice meanwhile
		const held = this.#instancePorts(nodeId);
		const kept = reserved.filter((port, index) => index < configured || held.has(port));
		while (kept.length < configured) kept.push(this.#mintPort(kept));

		// Trimming and topping up are exclusive, so a length change is the whole difference
		if (kept.length !== reserved.length) {
			this.#graphState.setNodePorts(nodeId, kept);
			this.#scheduleDependents(nodeId);
		}
	}

	// Reservations are exclusive, so the only thing a new instance has to avoid is the
	// node's own live ones
	#takePort(nodeId: string): number {
		const reserved = this.getReservedPorts(nodeId);
		const used = this.#instancePorts(nodeId);
		const free = reserved.find((port) => !used.has(port));
		if (free !== undefined) return free;

		// Every reserved port is taken, because a stale instance could not be stopped. The
		// extra joins the reservation rather than being handed back with the instance
		const port = this.#mintPort();
		this.#graphState.setNodePorts(nodeId, [...reserved, port]);
		return port;
	}

	// The ports this node's live instances hold
	#instancePorts(nodeId: string): Set<number> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		return new Set(this.getInstances(nodeId).map((instance) => instance.port));
	}

	// Mints a port held by no node. A reservation is released only with its node - never
	// while another node could still be using it - and a deleted node's instances outlive
	// it, so their ports are excluded too. alsoTaken covers same-loop mints not yet persisted
	#mintPort(alsoTaken: readonly number[] = []): number {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const reserved = new Set([
			...alsoTaken,
			...this.#graphState.nodes.flatMap(nodePorts),
			...[...this.#controllers.values()].flatMap((controller) =>
				controller.instances.map((instance) => instance.port)
			)
		]);
		let port: number;
		do {
			port = Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
		} while (reserved.has(port));
		return port;
	}

	#scheduleDependents(nodeId: string) {
		for (const edge of this.#graphState.edges) {
			if (edge.target === nodeId) this.#controllers.get(edge.source)?.schedule();
		}
	}
}

const orchestratorContext = createContext<Orchestrator>('ORCHESTRATOR');

export function setOrchestrator(graphState: GraphState) {
	return orchestratorContext.set(new Orchestrator(graphState));
}

export const getOrchestrator = orchestratorContext.get;
