import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { Node } from '@xyflow/svelte';
import { GraphState } from './graph-state.svelte';
import { FileStore } from './file-store.svelte';
import {
	getResourceDefinition,
	type EventContext,
	type ResourceDefinition
} from './resource-definitions';
import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { getWebContainer, mountNodeFiles } from './webcontainer';

// IANA registered port range
const MIN_PORT = 1024;
const MAX_PORT = 49151;

// No 'stopped': a stopped instance is dropped from its group
// 'unresponsive' means failed to stop/kill the instance/process
export type InstanceStatus = 'starting' | 'running' | 'stopping' | 'crashed' | 'unresponsive';

// A resource aggregates its instances, so it has two states no single instance can be in:
// 'stopped' when it has none left, and 'degraded' when only some of them are running
export type ResourceStatus = InstanceStatus | 'stopped' | 'degraded';

// A port is reserved first, then process starts and gives a preview URL
export type Instance = {
	port: number;
	status: InstanceStatus;
	process?: WebContainerProcess;
	previewUrl?: string;
};

// The definition is kept here rather than looked up, so a pool can still
// be stopped after its node is deleted from the graph
type Pool = {
	definition: ResourceDefinition;
	instances: Instance[];
};

export class Orchestrator {
	#graphState: GraphState;
	#fileStore: FileStore;
	#pools = new SvelteMap<string, Pool>();
	#webContainerPromise: Promise<WebContainer> | undefined;

	constructor(graphState: GraphState, fileStore: FileStore) {
		this.#graphState = graphState;
		this.#fileStore = fileStore;
	}

	getStatus(nodeId: string): ResourceStatus {
		const instances = this.getInstances(nodeId);
		if (instances.length === 0) return 'stopped';
		if (instances.every((instance) => instance.status === 'running')) return 'running';
		// 'starting' and 'stopping' take precedent because canStart and canStop gate on these
		// and we don't want overlapping runs
		if (instances.some((instance) => instance.status === 'starting')) return 'starting';
		if (instances.some((instance) => instance.status === 'stopping')) return 'stopping';
		if (instances.some((instance) => instance.status === 'unresponsive')) return 'unresponsive';
		if (instances.some((instance) => instance.status === 'running')) return 'degraded';
		return 'crashed';
	}

	getInstances(nodeId: string): Instance[] {
		return this.#pools.get(nodeId)?.instances ?? [];
	}

	// A stopping instance still owns its process and its port until the kill lands, so it
	// counts as up and the number ticks down as each one actually dies
	getUpCount(nodeId: string): number {
		return this.getInstances(nodeId).filter(
			(instance) => instance.status === 'running' || instance.status === 'stopping'
		).length;
	}

	getDesiredCount(nodeId: string): number {
		const node = this.#graphState.getNode(nodeId);
		return node ? getResourceDefinition(node).instanceCount(node) : 0;
	}

	// Every method takes a node id and resolves the node from the graph rather than accepting
	// a Node, so a caller holding a stale copy still reads current config
	canStart(nodeId: string): boolean {
		const node = this.#graphState.getNode(nodeId);
		if (!node) return false;

		const status = this.getStatus(nodeId);
		if (status === 'starting' || status === 'stopping') return false;

		const instances = this.getInstances(nodeId);
		if (instances.length !== getResourceDefinition(node).instanceCount(node)) return true;
		// At the right count there is only work to do if something crashed
		return instances.some((instance) => instance.status === 'crashed');
	}

	canStop(nodeId: string): boolean {
		return !['stopped', 'starting', 'stopping'].includes(this.getStatus(nodeId));
	}

	#getWebContainer() {
		this.#webContainerPromise ??= getWebContainer().then((webContainer) => {
			webContainer.on('server-ready', (port, url) => {
				const instance = this.#allInstances().find((instance) => instance.port === port);
				if (instance) instance.previewUrl = url;
			});
			return webContainer;
		});
		return this.#webContainerPromise;
	}

	#allInstances(): Instance[] {
		return [...this.#pools.values()].flatMap((pool) => pool.instances);
	}

	#allocatePort(): number {
		let port: number;
		do {
			port = Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
		} while (this.#allInstances().some((instance) => instance.port === port));
		return port;
	}

	// Rebuilt per call rather than cached, so a definition always reads current edges
	#eventContext(nodeId: string): EventContext {
		return {
			outgoingEdges: this.#graphState.edges.filter((edge) => edge.source === nodeId),
			getInstances: (id: string) => this.getInstances(id)
		};
	}

	#poolFor(nodeId: string, definition: ResourceDefinition): Pool {
		const existing = this.#pools.get(nodeId);
		if (existing) return existing;
		const instances = $state<Instance[]>([]);
		const pool = { definition, instances };
		this.#pools.set(nodeId, pool);
		return pool;
	}

	async #startInstance(
		node: Node,
		definition: ResourceDefinition,
		webContainer: WebContainer,
		instances: Instance[],
		instance: Instance
	) {
		try {
			// #stopInstance drops an instance that has no process yet, so a stop that lands
			// while the pool is preparing removes this one before it owns anything
			if (!instances.includes(instance)) return;

			const process = await definition.start(
				node,
				webContainer,
				instance.port,
				this.#eventContext(node.id)
			);

			// A stop can also land while the process is spawning. Once it has dropped the
			// instance nothing else holds the process, so this is the only chance to kill it
			if (!instances.includes(instance)) {
				try {
					await definition.stop(process);
				} catch (e) {
					console.error(e);
					// The kill failed, so put the instance back rather than leaving a live process with nothing tracking it.
					// A later stop can retry. #poolFor rather than the captured array because the
					// stop that dropped this instance may have deleted the pool it came from
					instance.process = process;
					instance.status = 'unresponsive';
					this.#poolFor(node.id, definition).instances.push(instance);
				}
				return;
			}

			instance.process = process;
			instance.status = 'running';

			process.exit.then(() => {
				instance.previewUrl = undefined;
				instance.process = undefined;
				// A deliberate stop sets 'stopping' first, so 'running' here means it crashed unexpectedly
				if (instance.status === 'running') {
					instance.status = 'crashed';
					this.updateDependents(node.id);
				}
			});
		} catch (e) {
			console.error(e);
			instance.status = 'crashed';
		}
	}

	// Drops the instance from its group once it is gone
	async #stopInstance(definition: ResourceDefinition, instances: Instance[], instance: Instance) {
		const process = instance.process;
		if (process) {
			instance.status = 'stopping';
			try {
				await definition.stop(process);
			} catch (e) {
				console.error(e);
				// Keeps its slot, its process and its reserved port so a later stop can retry the kill
				instance.status = 'unresponsive';
				return;
			}
		}
		const position = instances.indexOf(instance);
		if (position !== -1) instances.splice(position, 1);
	}

	// Tries to reach group's configured instance count without bouncing any instances
	async start(nodeId: string) {
		const node = this.#graphState.getNode(nodeId);
		if (!node || !this.canStart(nodeId)) return;

		const definition = getResourceDefinition(node);
		const { instances } = this.#poolFor(nodeId, definition);
		const desired = definition.instanceCount(node);

		// Reclaim the slots held by instances that died on their own
		for (let i = instances.length - 1; i >= 0; i--) {
			if (instances[i].status === 'crashed') instances.splice(i, 1);
		}

		// Scale down. Instances that fail to stop drop out of the surplus but stay in the
		// group, leaving the count high so a later start retries them
		if (instances.length > desired) {
			const surplus = instances.slice(desired);
			await Promise.all(
				surplus.map((instance) => this.#stopInstance(definition, instances, instance))
			);
		}

		while (instances.length < desired) {
			instances.push({ port: this.#allocatePort(), status: 'starting' });
		}

		// Set of instances that need a process spawned in them
		const pending = instances.filter((instance) => instance.status === 'starting');
		if (pending.length > 0) {
			try {
				const webContainer = await this.#getWebContainer();
				const fileTree = await this.#fileStore.loadFiles(node.id);
				await mountNodeFiles(node.id, fileTree ?? definition.snapshot);
				// Runs once per group rather than once per instance, so instances don't race each other
				await definition.prepare(node, webContainer);
				await Promise.all(
					pending.map((instance) =>
						this.#startInstance(node, definition, webContainer, instances, instance)
					)
				);
			} catch (e) {
				// Only group-wide failures land here (boot, mount, npm install) - per-instance
				// failures are recorded inside #startInstance
				console.error(e);
				for (const instance of pending) instance.status = 'crashed';
			}
		}

		// Scaling either way changes the ports a dependent should be routing to
		await this.updateDependents(nodeId);
	}

	async updateDependents(nodeId: string) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const sourceIds = new Set(
			this.#graphState.edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source)
		);
		if (sourceIds.size === 0) return;

		const webContainer = await this.#getWebContainer();
		await Promise.all(
			[...sourceIds].map(async (sourceId) => {
				const pool = this.#pools.get(sourceId);
				const node = this.#graphState.getNode(sourceId);
				if (!pool || !node || !pool.definition.update) return;

				try {
					await pool.definition.update(node, webContainer, this.#eventContext(sourceId));
				} catch (e) {
					// One dependent that can't be reconfigured keeps its old config rather than
					// failing the batch
					console.error(e);
				}
			})
		);
	}

	async startAll() {
		await Promise.all(this.#graphState.nodes.map((node) => this.start(node.id)));
	}

	async stop(nodeId: string) {
		if (!this.canStop(nodeId)) return;
		await this.#stopPool(nodeId);
	}

	// Called once a node is gone from the graph. Skips canStop because a node deleted while
	// starting or stopping still has to give its processes back
	async remove(nodeId: string) {
		await this.#stopPool(nodeId);
	}

	// Works off the pool alone, with no lookup in the graph, so a node deleted from the canvas
	// can still have its processes killed
	async #stopPool(nodeId: string) {
		const pool = this.#pools.get(nodeId);
		if (!pool) return;

		const { definition, instances } = pool;

		// Iterated over a copy so instances that remove themselves don't cause the next one to be skipped
		await Promise.all(
			[...instances].map((instance) => this.#stopInstance(definition, instances, instance))
		);

		// #stopInstance drops each one as it goes, so an empty pool means every process is
		// gone. Anything that failed to stop is left for the next try
		if (instances.length === 0) this.#pools.delete(nodeId);

		await this.updateDependents(nodeId);
	}

	async stopAll() {
		await Promise.all(this.#graphState.nodes.map((node) => this.stop(node.id)));
	}
}

const ORCHESTRATOR_KEY = Symbol('ORCHESTRATOR');

export function setOrchestrator(graphState: GraphState, fileStore: FileStore) {
	return setContext(ORCHESTRATOR_KEY, new Orchestrator(graphState, fileStore));
}

export function getOrchestrator() {
	return getContext<ReturnType<typeof setOrchestrator>>(ORCHESTRATOR_KEY);
}
