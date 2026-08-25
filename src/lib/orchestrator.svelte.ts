import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { GraphState } from './graph-state.svelte';
import { FileState } from './file-state.svelte';
import { resourceDefinitions, type ResourceType } from './resource-definitions';
import { WebContainer, type WebContainerProcess } from '@webcontainer/api';

export class Orchestrator {
	#graphState: GraphState;
	#fileState: FileState;
	#processes = new SvelteMap<string, WebContainerProcess>();
	#statuses = new SvelteMap<string, ResourceStatus>();
	#webContainerPromise: Promise<WebContainer> | undefined;

	constructor(graphState: GraphState, fileState: FileState) {
		this.#graphState = graphState;
		this.#fileState = fileState;
	}

	getStatus(nodeId: string): ResourceStatus {
		return this.#statuses.get(nodeId) ?? 'stopped';
	}

	#getWebContainer() {
		this.#webContainerPromise ??= WebContainer.boot({ workdirName: 'infralab' });
		return this.#webContainerPromise;
	}

	startAll() {
		this.#graphState.nodes.forEach((node) => {
			if (['running', 'starting', 'stopping'].includes(this.getStatus(node.id))) return;
			this.#statuses.set(node.id, 'starting');
			this.#getWebContainer()
				.then(async (webContainer) => {
					if (resourceDefinitions[node.type as ResourceType].hasEditableFiles) {
						const fileTree = await this.#fileState.loadFiles(node.id);
						if (fileTree) {
							await webContainer.fs.mkdir(node.id, { recursive: true });
							await webContainer.mount(fileTree, { mountPoint: node.id });
						}
					}
					return resourceDefinitions[node.type as ResourceType].start(node, webContainer);
				})
				.then((process) => {
					this.#processes.set(node.id, process);
					this.#statuses.set(node.id, 'running');
				})
				.catch((e) => {
					console.log(e);
					this.#statuses.set(node.id, 'crashed');
				});
		});
	}

	stopAll() {
		this.#graphState.nodes.forEach((node) => {
			if (['stopped', 'starting', 'stopping'].includes(this.getStatus(node.id))) return;
			const process = this.#processes.get(node.id);
			if (!process) return;

			this.#statuses.set(node.id, 'stopping');
			resourceDefinitions[node.type as ResourceType]
				.stop(process)
				.then(() => {
					this.#processes.delete(node.id);
					this.#statuses.set(node.id, 'stopped');
				})
				.catch((e) => {
					console.log(e);
					this.#statuses.set(node.id, 'crashed');
				});
		});
	}
}

const ORCHESTRATOR_KEY = Symbol('ORCHESTRATOR');

export function setOrchestrator(graphState: GraphState, fileState: FileState) {
	return setContext(ORCHESTRATOR_KEY, new Orchestrator(graphState, fileState));
}

export function getOrchestrator() {
	return getContext<ReturnType<typeof setOrchestrator>>(ORCHESTRATOR_KEY);
}
