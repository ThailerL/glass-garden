import { getContext, setContext } from 'svelte';
import { type Edge, type Node } from '@xyflow/svelte';
import { nanoid } from 'nanoid';
import { FileState } from './file-state.svelte';
import { resourceDefinitions, defaultFiles, type ResourceType } from './resource-definitions';

export class GraphState {
	nodes = $state.raw<Node[]>([]);
	edges = $state.raw<Edge[]>([]);
	#fileState: FileState;

	constructor(fileState: FileState) {
		this.nodes = Object.keys(localStorage)
			.filter((key) => key.startsWith('node'))
			.map((key) => JSON.parse(localStorage[key]));
		this.edges = Object.keys(localStorage)
			.filter((key) => key.startsWith('edge'))
			.map((key) => JSON.parse(localStorage[key]));

		this.#fileState = fileState;
	}

	async addNode(
		type: ResourceType,
		position: { x: number; y: number },
		data: Record<string, unknown>
	) {
		const node: Node = {
			id: nanoid(8),
			type,
			position,
			data,
			origin: [0.5, 0.5]
		};
		this.nodes = [...this.nodes, node];
		this.setNodeInStorage(node);

		if (resourceDefinitions[type].hasEditableFiles) {
			this.#fileState.setFiles(node.id, defaultFiles);
		}
	}

	getNode(id: string) {
		return this.nodes.find((node) => node.id === id);
	}

	setNodeInStorage(node: Node) {
		node.selected = false;
		localStorage.setItem(`node:${node.id}`, JSON.stringify(node));
	}

	setEdgeInStorage(edge: Edge) {
		edge.selected = false;
		localStorage.setItem(`edge:${edge.id}`, JSON.stringify(edge));
	}

	async deleteNodeFromStorage(id: string) {
		localStorage.removeItem(`node:${id}`);
		this.#fileState.deleteFiles(id);
	}

	deleteEdgeFromStorage(id: string) {
		localStorage.removeItem(`edge:${id}`);
	}
}

const GRAPH_KEY = Symbol('GRAPH');

export function setGraphState(fileState: FileState) {
	return setContext(GRAPH_KEY, new GraphState(fileState));
}

export function getGraphState() {
	return getContext<ReturnType<typeof setGraphState>>(GRAPH_KEY);
}
