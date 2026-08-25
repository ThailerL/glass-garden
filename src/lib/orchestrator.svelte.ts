import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { Node } from '@xyflow/svelte';
import { GraphState } from './graph-state.svelte';
import { FileState } from './file-state.svelte';
import { resourceDefinitions, type ResourceType } from './resource-definitions';
import { WebContainer, type WebContainerProcess } from '@webcontainer/api';

export class Orchestrator {
	#graphState: GraphState;
	#fileState: FileState;
	#processes = new SvelteMap<string, WebContainerProcess>();
	#statuses = new SvelteMap<string, ResourceStatus>();
	#previewUrls = new SvelteMap<string, string>();
	#webContainerPromise: Promise<WebContainer> | undefined;

	constructor(graphState: GraphState, fileState: FileState) {
		this.#graphState = graphState;
		this.#fileState = fileState;
	}

	getStatus(nodeId: string): ResourceStatus {
		return this.#statuses.get(nodeId) ?? 'stopped';
	}

	getPreviewUrl(nodeId: string): string | undefined {
		return this.#previewUrls.get(nodeId);
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
				// server-ready only gives us a port, not which node started the so we have to derive it
				webContainer.on('server-ready', (port, url) => {
					const node = this.#graphState.nodes.find(
						(node) => (node.data as Record<string, unknown>).port === port
					);
					if (node) this.#previewUrls.set(node.id, url);
				});
				return webContainer;
			}
		);
		return this.#webContainerPromise;
	}

	start(node: Node) {
		if (!this.canStart(node.id)) return;
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

				process.exit.then(() => {
					this.#previewUrls.delete(node.id);

					// Set status to 'crashed' if process ends unexpectedly
					if (this.getStatus(node.id) === 'running') {
						this.#processes.delete(node.id);
						this.#statuses.set(node.id, 'crashed');
					}
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
