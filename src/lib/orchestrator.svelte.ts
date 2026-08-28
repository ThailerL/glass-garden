import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { Node } from '@xyflow/svelte';
import type { Vivari } from '@vivari/core';
import { GraphState } from './graph-state.svelte';
import { FileStore } from './file-store.svelte';
import {
	getResourceDefinition,
	type Instance,
	type ResourceStatus,
	type UpstreamContext
} from './resources';
import {
	ResourceController,
	type ControllerServices,
	type ResourceEvent
} from './resource-controller.svelte';
import { getContainer } from './container';

// IANA registered port range
const MIN_PORT = 1024;
const MAX_PORT = 49151;

// Registry of one ResourceController per node, plus the cross-node concerns the
// controllers share: the container, port uniqueness and dependent wiring
export class Orchestrator {
	#graphState: GraphState;
	#fileStore: FileStore;
	#controllers = new SvelteMap<string, ResourceController>();
	#containerPromise: Promise<Vivari> | undefined;

	constructor(graphState: GraphState, fileStore: FileStore) {
		this.#graphState = graphState;
		this.#fileStore = fileStore;
	}

	getStatus(nodeId: string): ResourceStatus {
		return this.#controllers.get(nodeId)?.status ?? 'stopped';
	}

	getInstances(nodeId: string): Instance[] {
		return this.#controllers.get(nodeId)?.instances ?? [];
	}

	getUpCount(nodeId: string): number {
		return this.#controllers.get(nodeId)?.upCount ?? 0;
	}

	getConfiguredCount(nodeId: string): number {
		const node = this.#graphState.getNode(nodeId);
		return node ? getResourceDefinition(node.type).instanceCount(node) : 0;
	}

	getEvents(nodeId: string): ResourceEvent[] {
		return this.#controllers.get(nodeId)?.events ?? [];
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
	// state, so the deleted node's processes are still given back
	remove(nodeId: string) {
		this.#controllers.get(nodeId)?.forget();
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
			loadFiles: () => this.#fileStore.loadFiles(nodeId),
			allocatePort: () => this.#allocatePort(),
			getUpstreamContext: () => this.#upstreamContext(nodeId),
			scheduleDependents: () => this.#scheduleDependents(nodeId),
			unregister: () => void this.#controllers.delete(nodeId)
		};
	}

	#getContainer() {
		this.#containerPromise ??= getContainer().then((container) => {
			container.on('server-ready', (port, url) => {
				for (const controller of this.#controllers.values()) {
					if (controller.onServerReady(port, url)) return;
				}
			});
			return container;
		});
		return this.#containerPromise;
	}

	// Mints a port reserved by no node. A reservation outlives the instance that
	// prompted it and is only released when its node is deleted and the controller
	// unregisters, so a port is never handed to a second node while the first still
	// exists. Every live port is in its own node's reservations, so this is strictly
	// stronger than checking instances
	#allocatePort(): number {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const reserved = new Set(
			[...this.#controllers.values()].flatMap((controller) => controller.reservedPorts)
		);
		let port: number;
		do {
			port = Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
		} while (reserved.has(port));
		return port;
	}

	// Rebuilt per call rather than cached, so a definition always reads current edges
	#upstreamContext(nodeId: string): UpstreamContext {
		return {
			upstreams: this.#graphState.edges
				.filter((edge) => edge.source === nodeId)
				.map((edge) => ({ nodeId: edge.target, instances: this.getInstances(edge.target) }))
		};
	}

	#scheduleDependents(nodeId: string) {
		for (const edge of this.#graphState.edges) {
			if (edge.target === nodeId) this.#controllers.get(edge.source)?.schedule();
		}
	}
}

const ORCHESTRATOR_KEY = Symbol('ORCHESTRATOR');

export function setOrchestrator(graphState: GraphState, fileStore: FileStore) {
	return setContext(ORCHESTRATOR_KEY, new Orchestrator(graphState, fileStore));
}

export function getOrchestrator() {
	return getContext<ReturnType<typeof setOrchestrator>>(ORCHESTRATOR_KEY);
}
