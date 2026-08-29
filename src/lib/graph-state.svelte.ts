import { getContext, setContext } from 'svelte';
import { type Edge, type Node } from '@xyflow/svelte';
import { nanoid } from 'nanoid';
import { getResourceDefinition, type ResourceType } from './resources';

export type NodeData = {
	config: Record<string, unknown>;
	// Ports reserved to this node, so dependents can be wired to it before it has ever run
	ports: number[];
};

// Takes anything carrying node data, so a NodeProps in a component reads it the same way
export function nodeConfig<T = Record<string, unknown>>(node: { data: Node['data'] }): T {
	return (node.data as NodeData).config as T;
}

export function nodePorts(node: Node): readonly number[] {
	return (node.data as NodeData).ports;
}

export class GraphState {
	nodes = $state.raw<Node[]>([]);
	edges = $state.raw<Edge[]>([]);

	constructor() {
		this.nodes = Object.keys(localStorage)
			.filter((key) => key.startsWith('node:'))
			.map((key) => this.#migrate(JSON.parse(localStorage[key])));
		this.edges = Object.keys(localStorage)
			.filter((key) => key.startsWith('edge:'))
			.map((key) => JSON.parse(localStorage[key]));
	}

	addNode(type: ResourceType, position: { x: number; y: number }) {
		const data: NodeData = {
			// Parsing an empty object yields the schema's defaults
			config: getResourceDefinition(type).configSchema.parse({}),
			ports: []
		};
		const node: Node = {
			id: nanoid(8),
			type,
			position,
			data,
			origin: [0.5, 0.5]
		};
		this.nodes = [...this.nodes, node];
		this.setNodeInStorage(node);
		return node;
	}

	addEdge(source: string, target: string) {
		const edge: Edge = { id: nanoid(8), source, target };
		this.edges = [...this.edges, edge];
		this.setEdgeInStorage(edge);
		return edge;
	}

	getNode(id: string) {
		return this.nodes.find((node) => node.id === id);
	}

	// nodes is $state.raw, so the array is replaced rather than the node mutated in place.
	// The config is snapshotted because callers pass a live form object they keep editing
	updateNodeConfig(id: string, config: Record<string, unknown>) {
		const updated = this.nodes.map((node) =>
			node.id === id
				? { ...node, data: { ...(node.data as NodeData), config: $state.snapshot(config) } }
				: node
		);
		this.nodes = updated;

		const node = updated.find((node) => node.id === id);
		if (node) this.setNodeInStorage(node);
	}

	// Mutates the node in place rather than replacing the array, because ports are minted
	// during reads that happen inside deriveds, where replacing state would throw. Safe
	// only because nodes is $state.raw and its nodes are therefore not proxied
	setNodePorts(node: Node, ports: number[]) {
		(node.data as NodeData).ports = ports;
		this.setNodeInStorage(node);
	}

	// Nodes saved before config and ports were split kept the config at the top of data
	#migrate(node: Node): Node {
		if ('config' in node.data) return node;
		const migrated = { ...node, data: { config: node.data, ports: [] } };
		this.setNodeInStorage(migrated);
		return migrated;
	}

	// Clones before clearing `selected` so persisted state doesn't affect the live node,
	// which is the same object reference when called from updateNodeData
	setNodeInStorage(node: Node) {
		localStorage.setItem(`node:${node.id}`, JSON.stringify({ ...node, selected: false }));
	}

	setEdgeInStorage(edge: Edge) {
		localStorage.setItem(`edge:${edge.id}`, JSON.stringify({ ...edge, selected: false }));
	}

	deleteNodeFromStorage(id: string) {
		localStorage.removeItem(`node:${id}`);
	}

	deleteEdgeFromStorage(id: string) {
		localStorage.removeItem(`edge:${id}`);
	}
}

const GRAPH_KEY = Symbol('GRAPH');

export function setGraphState() {
	return setContext(GRAPH_KEY, new GraphState());
}

export function getGraphState() {
	return getContext<ReturnType<typeof setGraphState>>(GRAPH_KEY);
}
