import { getContext, setContext } from 'svelte';
import { type Edge, type Node } from '@xyflow/svelte';
import { nanoid } from 'nanoid';

export class InfrastructureState {
	nodes = $state.raw<Node[]>([]);
	edges = $state.raw<Edge[]>([]);

	constructor() {
		this.nodes = Object.keys(localStorage)
			.filter((key) => key.startsWith('node'))
			.map((key) => JSON.parse(localStorage[key]));
		this.edges = Object.keys(localStorage)
			.filter((key) => key.startsWith('edge'))
			.map((key) => JSON.parse(localStorage[key]));
	}

	addNode(type: string, position: { x: number; y: number }, data: Record<string, unknown>) {
		const node: Node = {
			id: nanoid(8),
			type,
			position,
			data,
			origin: [0.5, 0.5]
		};
		this.nodes = [...this.nodes, node];
		this.saveNodeInStorage(node);
	}

	getNode(id: string) {
		return this.nodes.find((node) => node.id === id);
	}

	saveNodeInStorage(node: Node) {
		node.selected = false;
		localStorage.setItem(`node:${node.id}`, JSON.stringify(node));
	}

	saveEdgeInStorage(edge: Edge) {
		edge.selected = false;
		localStorage.setItem(`edge:${edge.id}`, JSON.stringify(edge));
	}

	deleteNodeFromStorage(id: string) {
		localStorage.removeItem(`node:${id}`);
	}

	deleteEdgeFromStorage(id: string) {
		localStorage.removeItem(`edge:${id}`);
	}

	saveNodeFileDataInStorage(node: Node) {
		const oldNode = this.getNode(node.id);
		oldNode.data.files = node.data.files;
		localStorage.setItem(`node:${node.id}`, JSON.stringify(oldNode));
	}

	saveNodeCanvasDataInStorage(node: Node) {
		const oldNode = this.getNode(node.id);
		node.data.files = oldNode?.data.files;
		localStorage.setItem(`node:${node.id}`, JSON.stringify(node));
	}
}

const INFRASTRUCTURE_KEY = Symbol('INFRASTRUCTURE');

export function setInfrastructureState() {
	return setContext(INFRASTRUCTURE_KEY, new InfrastructureState());
}

export function getInfrastructueState() {
	return getContext<ReturnType<typeof setInfrastructureState>>(INFRASTRUCTURE_KEY);
}
