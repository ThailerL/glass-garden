import type { Edge, Node } from '@xyflow/svelte';

export function removeNodeFromLocalStorage(id: string) {
	localStorage.removeItem(`node:${id}`);
}

export function removeEdgeFromLocalStorage(id: string) {
	localStorage.removeItem(`edge:${id}`);
}

export function setNodeInLocalStorage(node: Node) {
	node.selected = false;
	localStorage.setItem(`node:${node.id}`, JSON.stringify(node));
}

export function setNodeFileDataInLocalStorage(node: Node) {
	const nodeInStorage = getNodeFromLocalStorage(node.id);
	nodeInStorage.data.files = node.data.files;
	localStorage.setItem(`node:${node.id}`, JSON.stringify(nodeInStorage));
}

export function setNodeCanvasDataInLocalStorage(node: Node) {
	const nodeInStorage = getNodeFromLocalStorage(node.id);
	node.data.files = nodeInStorage?.data.files;
	localStorage.setItem(`node:${node.id}`, JSON.stringify(node));
}

export function setEdgeInLocalStorage(edge: Edge) {
	edge.selected = false;
	localStorage.setItem(`edge:${edge.id}`, JSON.stringify(edge));
}

export function getNodeFromLocalStorage(id: string): Node | undefined {
	const node = localStorage.getItem(`node:${id}`);
	if (node) {
		return JSON.parse(node);
	}
	return undefined;
}

export function getEdgeFromLocalStorage(id: string): Edge | undefined {
	const edge = localStorage.getItem(`edge:${id}`);
	if (edge) {
		return JSON.parse(edge);
	}
	return undefined;
}

export function loadNodesFromLocalStorage(): Node[] {
	return Object.keys(localStorage)
		.filter((key) => key.startsWith('node'))
		.map((key) => JSON.parse(localStorage[key]));
}

export function loadEdgesFromLocalStorage(): Edge[] {
	return Object.keys(localStorage)
		.filter((key) => key.startsWith('edge'))
		.map((key) => JSON.parse(localStorage[key]));
}
