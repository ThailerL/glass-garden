import { getContext, setContext } from 'svelte';
import { type Edge, type Node } from '@xyflow/svelte';
import { nanoid } from 'nanoid';
import { FileStore } from './file-store.svelte';
import { resourceDefinitions, defaultFiles, type ResourceType } from './resource-definitions';

export class GraphState {
	nodes = $state.raw<Node[]>([]);
	edges = $state.raw<Edge[]>([]);
	#fileStore: FileStore;

	constructor(fileStore: FileStore) {
		this.nodes = Object.keys(localStorage)
			.filter((key) => key.startsWith('node:'))
			.map((key) => JSON.parse(localStorage[key]));
		this.edges = Object.keys(localStorage)
			.filter((key) => key.startsWith('edge:'))
			.map((key) => JSON.parse(localStorage[key]));

		this.#fileStore = fileStore;
	}

	async addNode(
		type: ResourceType,
		position: { x: number; y: number },
		config: Record<string, unknown>
	) {
		const node: Node = {
			id: nanoid(8),
			type,
			position,
			data: config,
			origin: [0.5, 0.5]
		};
		this.nodes = [...this.nodes, node];
		this.setNodeInStorage(node);

		if (resourceDefinitions[type].hasEditableFiles) {
			this.#fileStore.setFiles(node.id, defaultFiles);
		}
	}

	getNode(id: string) {
		return this.nodes.find((node) => node.id === id);
	}

	// nodes is $state.raw, so the array is replaced rather than the node mutated in place.
	// The data is snapshotted because callers pass a live form object they keep editing
	updateNodeData(id: string, data: Record<string, unknown>) {
		const updated = this.nodes.map((node) =>
			node.id === id ? { ...node, data: $state.snapshot(data) } : node
		);
		this.nodes = updated;

		const node = updated.find((node) => node.id === id);
		if (node) this.setNodeInStorage(node);
	}

	// Clones before clearing `selected` so persisted state doesn't affect the live node,
	// which is the same object reference when called from updateNodeData
	setNodeInStorage(node: Node) {
		localStorage.setItem(`node:${node.id}`, JSON.stringify({ ...node, selected: false }));
	}

	setEdgeInStorage(edge: Edge) {
		localStorage.setItem(`edge:${edge.id}`, JSON.stringify({ ...edge, selected: false }));
	}

	async deleteNodeFromStorage(id: string) {
		localStorage.removeItem(`node:${id}`);
		this.#fileStore.deleteFiles(id);
	}

	deleteEdgeFromStorage(id: string) {
		localStorage.removeItem(`edge:${id}`);
	}
}

const GRAPH_KEY = Symbol('GRAPH');

export function setGraphState(fileStore: FileStore) {
	return setContext(GRAPH_KEY, new GraphState(fileStore));
}

export function getGraphState() {
	return getContext<ReturnType<typeof setGraphState>>(GRAPH_KEY);
}
