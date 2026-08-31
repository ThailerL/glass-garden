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
import {
	ResourceController,
	type ControllerServices,
	type OutputLine,
	type ResourceEvent
} from './resource-controller.svelte';
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
	// Whether this boot has passed SLOW_BOOT_MS
	#slowBoot = $state(false);
	#slowBootTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(graphState: GraphState) {
		this.#graphState = graphState;
	}

	get containerReady(): boolean {
		return this.#containerReady;
	}

	get containerError(): string | undefined {
		return this.#containerError;
	}

	// A slow boot is a restore of the files on disk, and a database is almost always what
	// makes it slow, so a canvas with one can say so
	get restoringStoredData(): boolean {
		return this.#slowBoot && !this.#containerReady && anyStoredDataNodes();
	}

	warmUp() {
		// No node owns this failure, and nothing can run without it, so it is said once here
		// rather than waiting for the first start to report it as a failed prepare
		void this.#getContainer().catch(() => toast.error('Container failed to boot'));
	}

	reset() {
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

	// One port per configured instance, minted on first read rather than at spawn, so a
	// dependent can be wired to a target the node has not started on yet. The reads a start
	// pass makes are what put upstreams in a node's very first launch config
	getReservedPorts(nodeId: string): readonly number[] {
		const node = this.#graphState.getNode(nodeId);
		// A deleted node's ports go with it; its winding-down instances hold what they have
		if (!node) return [];

		const reserved = nodePorts(node);
		const configured = this.getConfiguredCount(nodeId);
		if (reserved.length >= configured) return reserved;

		const topped = [...reserved];
		while (topped.length < configured) topped.push(this.#mintPort());
		this.#graphState.setNodePorts(node, topped);
		return topped;
	}

	// Exposed so the config form can predict what a save would do to running instances
	getUpstreams(nodeId: string): readonly Upstream[] {
		return this.#upstreams(nodeId);
	}

	getEvents(nodeId: string): ResourceEvent[] {
		return this.#controllers.get(nodeId)?.events ?? [];
	}

	getOutput(nodeId: string): OutputLine[] {
		return this.#controllers.get(nodeId)?.output ?? [];
	}

	getRestarts(nodeId: string): number {
		return this.#controllers.get(nodeId)?.restarts ?? 0;
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
		this.#controllerFor(nodeId, node).start();
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

	// Called once a node is gone from the graph. The controller works off its own
	// state, so the deleted node's processes are still given back. Its files go with the
	// controller when it unregisters; a node that never ran has none to wait for
	remove(nodeId: string) {
		const controller = this.#controllers.get(nodeId);
		if (controller) controller.forget();
		else void removeNodeFiles(nodeId);
	}

	// Nudges a node's reconciler after something it reads changed: its config, or the
	// edges it routes through
	refresh(nodeId: string) {
		this.#controllers.get(nodeId)?.schedule();
	}

	#controllerFor(nodeId: string, node: Node): ResourceController {
		let controller = this.#controllers.get(nodeId);
		if (!controller) {
			controller = new ResourceController(
				nodeId,
				getResourceDefinition(node.type),
				this.#servicesFor(nodeId)
			);
			this.#controllers.set(nodeId, controller);
		}
		return controller;
	}

	#servicesFor(nodeId: string): ControllerServices {
		return {
			getNode: () => this.#graphState.getNode(nodeId),
			getContainer: () => this.#getContainer(),
			takePort: () => this.#takePort(nodeId),
			getUpstreams: () => this.#upstreams(nodeId),
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

	// Reservations are exclusive, so the only thing a new instance has to avoid is the
	// node's own live ones
	#takePort(nodeId: string): number {
		const reserved = this.getReservedPorts(nodeId);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const used = new Set(this.getInstances(nodeId).map((instance) => instance.port));
		const free = reserved.find((port) => !used.has(port));
		if (free !== undefined) return free;

		// Every reserved port is taken, because a stale instance could not be stopped. The
		// extra joins the reservation rather than being handed back with the instance
		const node = this.#graphState.getNode(nodeId);
		const port = this.#mintPort();
		if (node) this.#graphState.setNodePorts(node, [...reserved, port]);
		return port;
	}

	// Mints a port held by no node. A reservation lives on its node, so it is released only
	// when the node is deleted - never while a second node could still be using it. A
	// deleted node's instances outlive the node itself, so their ports are excluded too
	#mintPort(): number {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const reserved = new Set([
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

	// Rebuilt per call rather than cached, so a definition always reads current edges
	#upstreams(nodeId: string): Upstream[] {
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
