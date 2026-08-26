import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { Node } from '@xyflow/svelte';
import { GraphState } from './graph-state.svelte';
import { FileState } from './file-state.svelte';
import { resourceDefinitions, type ResourceType } from './resource-definitions';
import { WebContainer, type WebContainerProcess } from '@webcontainer/api';

// IANA registered port range
const MIN_PORT = 1024;
const MAX_PORT = 49151;

type ResourceDefinition = (typeof resourceDefinitions)[ResourceType];

// A port is reserved first, then process starts and gives a preview URL
export type Instance = {
	port: number;
	process?: WebContainerProcess;
	previewUrl?: string;
};

export class Orchestrator {
	#graphState: GraphState;
	#fileState: FileState;
	#instances = new SvelteMap<string, Instance[]>();
	#statuses = new SvelteMap<string, ResourceStatus>();
	#webContainerPromise: Promise<WebContainer> | undefined;

	constructor(graphState: GraphState, fileState: FileState) {
		this.#graphState = graphState;
		this.#fileState = fileState;
	}

	getStatus(nodeId: string): ResourceStatus {
		return this.#statuses.get(nodeId) ?? 'stopped';
	}

	getInstances(nodeId: string): Instance[] {
		return this.#instances.get(nodeId) ?? [];
	}

	canStart(nodeId: string): boolean {
		return !['running', 'starting', 'stopping'].includes(this.getStatus(nodeId));
	}

	canStop(nodeId: string): boolean {
		return !['stopped', 'starting', 'stopping'].includes(this.getStatus(nodeId));
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

	// If any process fails to spawn then the whole thing fails and cleans up
	async #spawnInstances(
		node: Node,
		definition: ResourceDefinition,
		webContainer: WebContainer,
		instances: Instance[]
	): Promise<WebContainerProcess[]> {
		const results = await Promise.allSettled(
			instances.map((instance) => definition.start(node, webContainer, instance.port))
		);

		const processes: WebContainerProcess[] = [];
		const errors: unknown[] = [];
		for (const result of results) {
			if (result.status === 'fulfilled') processes.push(result.value);
			else errors.push(result.reason);
		}

		if (errors.length > 0) {
			await Promise.all(processes.map((process) => definition.stop(process)));
			throw errors[0];
		}

		return processes;
	}

	start(node: Node) {
		if (!this.canStart(node.id)) return;
		this.#statuses.set(node.id, 'starting');

		const definition = resourceDefinitions[node.type as ResourceType];

		const instances = $state<Instance[]>([]);
		this.#instances.set(node.id, instances);
		for (let i = 0; i < definition.instanceCount(node); i++) {
			instances.push({ port: this.#allocatePort() });
		}

		this.#getWebContainer()
			.then(async (webContainer) => {
				if (definition.hasEditableFiles) {
					const fileTree = await this.#fileState.loadFiles(node.id);
					if (fileTree) {
						await webContainer.fs.mkdir(node.id, { recursive: true });
						await webContainer.mount(fileTree, { mountPoint: node.id });
					}
				}
				await definition.prepare(node, webContainer);
				return this.#spawnInstances(node, definition, webContainer, instances);
			})
			.then((processes) => {
				this.#statuses.set(node.id, 'running');

				processes.forEach((process, index) => {
					instances[index].process = process;

					process.exit.then(() => {
						instances[index].previewUrl = undefined;

						// Set status to 'crashed' if a process ends unexpectedly
						if (this.getStatus(node.id) === 'running') {
							this.#statuses.set(node.id, 'crashed');
						}
					});
				});
			})
			.catch((e) => {
				console.log(e);
				this.#statuses.set(node.id, 'crashed');
			});
	}

	startAll() {
		this.#graphState.nodes.forEach((node) => this.start(node));
	}

	stop(node: Node) {
		if (!this.canStop(node.id)) return;
		const processes = this.getInstances(node.id)
			.map((instance) => instance.process)
			.filter((process) => process !== undefined);
		if (processes.length === 0) return;

		const definition = resourceDefinitions[node.type as ResourceType];
		this.#statuses.set(node.id, 'stopping');
		Promise.all(processes.map((process) => definition.stop(process)))
			.then(() => {
				this.#instances.delete(node.id);
				this.#statuses.set(node.id, 'stopped');
			})
			.catch((e) => {
				console.log(e);
				this.#statuses.set(node.id, 'crashed');
			});
	}

	stopAll() {
		this.#graphState.nodes.forEach((node) => this.stop(node));
	}
}

const ORCHESTRATOR_KEY = Symbol('ORCHESTRATOR');

export function setOrchestrator(graphState: GraphState, fileState: FileState) {
	return setContext(ORCHESTRATOR_KEY, new Orchestrator(graphState, fileState));
}

export function getOrchestrator() {
	return getContext<ReturnType<typeof setOrchestrator>>(ORCHESTRATOR_KEY);
}
