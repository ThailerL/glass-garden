import { type Edge, type Node, type Viewport } from '@xyflow/svelte';
import { nanoid } from 'nanoid';
import { getResourceDefinition, resourceDefinitions, type ResourceType } from './resources';
import { requestPersistentStorage, setActiveProject } from './container';
import { createContext } from './context';
import { keysWithPrefix, readByPrefix, readEntry } from './storage';
import type { FileSetId } from './files/node-files';

export type NodeData = {
	config: Record<string, unknown>;
	// Ports reserved to this node, so others can be wired to it before it has ever run
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

export function nodeName(node: { data: Node['data'] }): string {
	return nodeConfig<{ name: string }>(node).name;
}

// One key space per project, so a graph's entries can be found and cleared as a set
export const GRAPH_PREFIX = 'graph:';

export function graphKeyPrefix(projectId: string) {
	return `${GRAPH_PREFIX}${projectId}:`;
}

// Every project's nodes share one VFS, so a boot restores them all - a database in a project
// not on screen still spends the wait. Read from storage, not a GraphState, for the same reason.
// Postgres specifically, not every resource that stores something: its files are the ones
// heavy enough to explain a slow boot
export function anyPostgresNodes(): boolean {
	return keysWithPrefix(GRAPH_PREFIX)
		.filter((key) => key.includes(':node:'))
		.some((key) => readEntry<Node>(key)?.type === ('postgres' satisfies ResourceType));
}

export class GraphState {
	nodes = $state.raw<Node[]>([]);
	edges = $state.raw<Edge[]>([]);
	// Where the canvas was left, so a trip to the editor and back does not refit the view.
	// Undefined until the first move, which is what lets a fresh graph open fitted
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
		setActiveProject(projectId);
		// Another project's graph is somewhere else entirely, so it starts fitted and unselected
		this.viewport = undefined;
		this.selectedNodeId = undefined;
		this.#prefix = graphKeyPrefix(projectId);
		this.nodes = readByPrefix<Node>(`${this.#prefix}node:`).flatMap(
			(node) => this.#loadNode(node) ?? []
		);
		// An edge to a node that did not load would be drawn into empty space
		this.edges = readByPrefix<Edge>(`${this.#prefix}edge:`).filter(
			(edge) => this.#hasNode(edge.source) && this.#hasNode(edge.target)
		);
	}

	#hasNode(id: string) {
		return this.nodes.some((node) => node.id === id);
	}

	// A stored config is re-parsed against the current schema: new options arrive at their
	// defaults, unused ones are pruned, and a resource type that no longer exists takes its node
	#loadNode(node: Node): Node | undefined {
		const definition = resourceDefinitions[node.type as ResourceType];
		if (!definition || !node.data) return undefined;

		const data = node.data as NodeData;
		// A config the schema has outgrown costs its settings rather than the node
		const parsed = definition.configSchema.safeParse(data.config);
		data.config = parsed.success ? parsed.data : definition.configSchema.parse({});
		return node;
	}

	addNode(
		type: ResourceType,
		position: { x: number; y: number },
		{ files, config }: { files?: FileSetId; config?: Record<string, unknown> } = {}
	) {
		const definition = getResourceDefinition(type);
		// Not awaited: on Firefox this prompts, and adding a node shouldn't wait on an answer
		if (definition.ownsStoredData) void requestPersistentStorage();
		const data: NodeData = {
			// Anything not supplied falls back to the schema's default
			config: definition.configSchema.parse(config ?? {}),
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
		this.#patchNodeData(id, { config: $state.snapshot(config) });
	}

	// Called from event and reconcile contexts, never during reads, so replacing state is safe
	setNodePorts(id: string, ports: number[]) {
		this.#patchNodeData(id, { ports });
	}

	#patchNodeData(id: string, patch: Partial<NodeData>) {
		const node = this.getNode(id);
		if (!node) return;
		const updated = { ...node, data: { ...(node.data as NodeData), ...patch } };
		this.nodes = this.nodes.map((existing) => (existing.id === id ? updated : existing));
		this.setNodeInStorage(updated);
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

const graphContext = createContext<GraphState>('GRAPH');

export function setGraphState(projectId: string) {
	return graphContext.set(new GraphState(projectId));
}

export const getGraphState = graphContext.get;
