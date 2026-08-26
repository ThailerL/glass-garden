import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { Node } from '@xyflow/svelte';
import { GraphState } from './graph-state.svelte';
import { FileState } from './file-state.svelte';
import { getResourceDefinition, type ResourceDefinition } from './resource-definitions';
import { WebContainer, type WebContainerProcess } from '@webcontainer/api';

// IANA registered port range
const MIN_PORT = 1024;
const MAX_PORT = 49151;

// No 'stopped': a stopped instance is dropped from its group
export type InstanceStatus = 'starting' | 'running' | 'stopping' | 'crashed';

// A port is reserved first, then process starts and gives a preview URL
export type Instance = {
	port: number;
	status: InstanceStatus;
	process?: WebContainerProcess;
	previewUrl?: string;
};

export class Orchestrator {
	#graphState: GraphState;
	#fileState: FileState;
	#instances = new SvelteMap<string, Instance[]>();
	#webContainerPromise: Promise<WebContainer> | undefined;

	constructor(graphState: GraphState, fileState: FileState) {
		this.#graphState = graphState;
		this.#fileState = fileState;
	}

	getStatus(nodeId: string): ResourceStatus {
		const instances = this.getInstances(nodeId);
		if (instances.length === 0) return 'stopped';
		if (instances.some((instance) => instance.status === 'starting')) return 'starting';
		if (instances.some((instance) => instance.status === 'stopping')) return 'stopping';
		if (instances.every((instance) => instance.status === 'running')) return 'running';
		if (instances.some((instance) => instance.status === 'running')) return 'degraded';
		return 'crashed';
	}

	getInstances(nodeId: string): Instance[] {
		return this.#instances.get(nodeId) ?? [];
	}

	canStart(node: Node): boolean {
		const status = this.getStatus(node.id);
		if (status === 'starting' || status === 'stopping') return false;

		const instances = this.getInstances(node.id);
		// Too few instances means there are some to add, too many means some to stop
		if (instances.length !== getResourceDefinition(node).instanceCount(node)) return true;
		// At the right count there is only work to do if something can be replaced
		return instances.some((instance) => this.#isReplaceable(instance));
	}

	canStop(node: Node): boolean {
		return !['stopped', 'starting', 'stopping'].includes(this.getStatus(node.id));
	}

	#getWebContainer() {
		this.#webContainerPromise ??= WebContainer.boot({ workdirName: 'infralab' }).then(
			(webContainer) => {
				webContainer.on('server-ready', (port, url) => {
					const instance = this.#allInstances().find((instance) => instance.port === port);
					if (instance) instance.previewUrl = url;
				});
				return webContainer;
			}
		);
		return this.#webContainerPromise;
	}

	#allInstances(): Instance[] {
		return [...this.#instances.values()].flat();
	}

	#allocatePort(): number {
		let port: number;
		do {
			port = Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
		} while (this.#allInstances().some((instance) => instance.port === port));
		return port;
	}

	// An instance whose process died on its own is kept so getStatus can report the crash,
	// and is only replaced by the next start. One that failed to stop still owns its
	// process, so it needs another stop rather than a replacement
	#isReplaceable(instance: Instance): boolean {
		return instance.status === 'crashed' && !instance.process;
	}

	#instancesFor(nodeId: string): Instance[] {
		const existing = this.#instances.get(nodeId);
		if (existing) return existing;
		const instances = $state<Instance[]>([]);
		this.#instances.set(nodeId, instances);
		return instances;
	}

	async #startInstance(
		node: Node,
		definition: ResourceDefinition,
		webContainer: WebContainer,
		instance: Instance
	) {
		try {
			const process = await definition.start(node, webContainer, instance.port);
			instance.process = process;
			instance.status = 'running';

			process.exit.then(() => {
				instance.previewUrl = undefined;
				instance.process = undefined;
				// A deliberate stop sets 'stopping' first, so 'running' here means it crashed unexpectedly
				if (instance.status === 'running') instance.status = 'crashed';
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
				// Keeps its slot and its reserved port so a later stop can retry the kill
				instance.status = 'crashed';
				return;
			}
		}
		const position = instances.indexOf(instance);
		if (position !== -1) instances.splice(position, 1);
	}

	// Tries to reach group's configured instance count without bouncing any instances
	async start(node: Node) {
		if (!this.canStart(node)) return;

		const definition = getResourceDefinition(node);
		const instances = this.#instancesFor(node.id);
		const desired = definition.instanceCount(node);

		// Reclaim the slots held by instances that died on their own
		for (let i = instances.length - 1; i >= 0; i--) {
			if (this.#isReplaceable(instances[i])) instances.splice(i, 1);
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
		if (pending.length === 0) return;

		try {
			const webContainer = await this.#getWebContainer();
			if (definition.hasEditableFiles) {
				const fileTree = await this.#fileState.loadFiles(node.id);
				if (fileTree) {
					await webContainer.fs.mkdir(node.id, { recursive: true });
					await webContainer.mount(fileTree, { mountPoint: node.id });
				}
			}
			// Runs once per group rather than once per instance, so instances don't race each other
			await definition.prepare(node, webContainer);
			await Promise.all(
				pending.map((instance) => this.#startInstance(node, definition, webContainer, instance))
			);
		} catch (e) {
			// Only group-wide failures land here (boot, mount, npm install) - per-instance
			// failures are recorded inside #startInstance
			console.error(e);
			for (const instance of pending) instance.status = 'crashed';
		}
	}

	async startAll() {
		await Promise.all(this.#graphState.nodes.map((node) => this.start(node)));
	}

	async stop(node: Node) {
		if (!this.canStop(node)) return;

		const definition = getResourceDefinition(node);
		const instances = this.getInstances(node.id);

		// Iterated over a copy so instances that remove themselves don't cause the next one to be skipped
		await Promise.all(
			[...instances].map((instance) => this.#stopInstance(definition, instances, instance))
		);

		// #stopInstance drops each one as it goes, so an empty group means every process is
		// gone. Anything that failed to stop is left for the next try
		if (instances.length === 0) this.#instances.delete(node.id);
	}

	async stopAll() {
		await Promise.all(this.#graphState.nodes.map((node) => this.stop(node)));
	}
}

const ORCHESTRATOR_KEY = Symbol('ORCHESTRATOR');

export function setOrchestrator(graphState: GraphState, fileState: FileState) {
	return setContext(ORCHESTRATOR_KEY, new Orchestrator(graphState, fileState));
}

export function getOrchestrator() {
	return getContext<ReturnType<typeof setOrchestrator>>(ORCHESTRATOR_KEY);
}
