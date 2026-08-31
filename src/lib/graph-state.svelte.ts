import { getContext, setContext } from 'svelte';
import { type Edge, type Node, type Viewport } from '@xyflow/svelte';
import { nanoid } from 'nanoid';
import { getResourceDefinition, resourceDefinitions, type ResourceType } from './resources';
import { requestPersistentStorage } from './container';
import type { FileSetId } from './node-files';

export type NodeData = {
	config: Record<string, unknown>;
	// Ports reserved to this node, so dependents can be wired to it before it has ever run
	ports: number[];
	// Set by a template whose node starts on files other than its resource type's
	files?: FileSetId;
};

// Takes anything carrying node data, so a NodeProps in a component reads it the same way
export function nodeConfig<T = Record<string, unknown>>(node: { data: Node['data'] }): T {
	return (node.data as NodeData).config as T;
}

export function nodePorts(node: Node): readonly number[] {
	return (node.data as NodeData).ports;
}

// Loading runs in the root layout, so anything thrown here costs the whole canvas rather
// than the entry that caused it. An unreadable one is skipped and left in storage
function readStored<T>(prefix: string): T[] {
	return Object.keys(localStorage)
		.filter((key) => key.startsWith(prefix))
		.flatMap((key) => {
			try {
				return [JSON.parse(localStorage[key]) as T];
			} catch {
				return [];
			}
		});
}

// One key space per project, so a graph's entries can be found and cleared as a set
export const GRAPH_PREFIX = 'graph:';

export function graphKeyPrefix(projectId: string) {
	return `${GRAPH_PREFIX}${projectId}:`;
}

// Every project's nodes share one VFS, so a boot restores all of them and not just the graph
// on screen: a database left in a project the reader is not looking at is still what the wait
// is spent on. Read from storage rather than a GraphState for the same reason
export function anyStoredDataNodes(): boolean {
	return Object.keys(localStorage).some((key) => {
		if (!key.startsWith(GRAPH_PREFIX) || !key.includes(':node:')) return false;
		try {
			const { type } = JSON.parse(localStorage[key]) as Node;
			return resourceDefinitions[type as ResourceType]?.ownsStoredData ?? false;
		} catch {
			return false;
		}
	});
}

export class GraphState {
	nodes = $state.raw<Node[]>([]);
	edges = $state.raw<Edge[]>([]);
	// Where the canvas was left, so a trip to the editor and back does not fit the view afresh
	// over wherever the reader had panned. Undefined until the first move, which is what still
	// lets a graph open on a fitted view
	viewport = $state.raw<Viewport | undefined>(undefined);
	// Which node the canvas had selected. Selection otherwise lives on the nodes, but the flow
	// unselects everything as it unmounts and that lands in `nodes`, so the id is kept apart
	selectedNodeId = $state<string | undefined>(undefined);
	projectId = $state('');
	#prefix = '';

	constructor(projectId: string) {
		this.switchTo(projectId);
	}

	switchTo(projectId: string) {
		this.projectId = projectId;
		// Another project's graph is somewhere else entirely, so it starts fitted and unselected
		this.viewport = undefined;
		this.selectedNodeId = undefined;
		this.#prefix = graphKeyPrefix(projectId);
		this.nodes = readStored<Node>(`${this.#prefix}node:`).flatMap(
			(node) => this.#loadNode(node) ?? []
		);
		// An edge to a node that did not load points at nothing, and the canvas would draw it
		// into empty space
		this.edges = readStored<Edge>(`${this.#prefix}edge:`).filter(
			(edge) => this.#hasNode(edge.source) && this.#hasNode(edge.target)
		);
	}

	#hasNode(id: string) {
		return this.nodes.some((node) => node.id === id);
	}

	// A stored config was written against whatever schema its resource had at the time, so it
	// is parsed again on load. An option added since then arrives at its default and unused
	// options are pruned. A resource type that no longer exists takes its node with it
	#loadNode(node: Node): Node | undefined {
		const definition = resourceDefinitions[node.type as ResourceType];
		if (!definition || !node.data) return undefined;

		const data = node.data as NodeData;
		// Falls back to the schema's own defaults, so a config the schema has since outgrown
		// costs its settings rather than the node
		const parsed = definition.configSchema.safeParse(data.config);
		data.config = parsed.success ? parsed.data : definition.configSchema.parse({});
		data.ports ??= [];
		return node;
	}

	addNode(type: ResourceType, position: { x: number; y: number }, files?: FileSetId) {
		const definition = getResourceDefinition(type);
		// Not awaited: on Firefox this prompts, and adding a node shouldn't wait on an answer
		if (definition.ownsStoredData) void requestPersistentStorage();
		const data: NodeData = {
			// Parsing an empty object yields the schema's defaults
			config: definition.configSchema.parse({}),
			ports: [],
			files
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

	select(id: string) {
		this.nodes = this.nodes.map((node) => ({ ...node, selected: node.id === id }));
	}

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

	setNodeInStorage(node: Node) {
		localStorage.setItem(
			`${this.#prefix}node:${node.id}`,
			JSON.stringify({ ...node, selected: false })
		);
	}

	setEdgeInStorage(edge: Edge) {
		localStorage.setItem(
			`${this.#prefix}edge:${edge.id}`,
			JSON.stringify({ ...edge, selected: false })
		);
	}

	deleteNodeFromStorage(id: string) {
		localStorage.removeItem(`${this.#prefix}node:${id}`);
	}

	deleteEdgeFromStorage(id: string) {
		localStorage.removeItem(`${this.#prefix}edge:${id}`);
	}
}

const GRAPH_KEY = Symbol('GRAPH');

export function setGraphState(projectId: string) {
	return setContext(GRAPH_KEY, new GraphState(projectId));
}

export function getGraphState() {
	return getContext<ReturnType<typeof setGraphState>>(GRAPH_KEY);
}
