import { type Edge, type Node, type Viewport } from '@xyflow/svelte';
import { nanoid } from 'nanoid';
import {
	getResourceDefinition,
	ownsStoredData,
	resourceDefinitions,
	type ResourceDefinition,
	type ResourceType
} from './resources';
import { requestPersistentStorage, setActiveProject } from './container';
import { createContext } from './context';
import { readByPrefix, readEntry } from './storage';
import type { FileSetId } from './files/node-files';
import type { NodeFiles } from './project-document';

export type NodeData = {
	config: Record<string, unknown>;
	// Ports reserved to this node, so others can be wired to it before it has ever run
	ports: number[];
	// Set by a template whose node starts on files other than its resource type's
	files?: FileSetId;
	// The code an imported document gave this node to start on
	code?: NodeFiles;
	// The one metric charted under the node on the canvas
	chart?: string;
	// The event this node's Test tab last invoked it with
	testEvent?: string;
	// Laid down by a challenge's starting canvas, so its goals and events may name it
	authored?: boolean;
};

// Takes anything carrying node data, so a NodeProps in a component reads it the same way
export function nodeConfig<T = Record<string, unknown>>(node: { data: Node['data'] }): T {
	return (node.data as NodeData).config as T;
}

export function nodePorts(node: Node): readonly number[] {
	return (node.data as NodeData).ports;
}

export function nodeChart(node: { data: Node['data'] }): string | undefined {
	return (node.data as NodeData).chart;
}

export function nodeTestEvent(node: { data: Node['data'] }): string | undefined {
	return (node.data as NodeData).testEvent;
}

export function nodeAuthored(node: { data: Node['data'] }): boolean | undefined {
	return (node.data as NodeData).authored;
}

export function nodeName(node: { data: Node['data'] }): string {
	return nodeConfig<{ name: string }>(node).name;
}

// Two authored nodes of one name would leave a challenge's reference answering for both
export function nameTakenByChallenge(
	nodes: readonly Node[],
	renamed: Node,
	name: unknown
): boolean {
	if (!nodeAuthored(renamed)) return false;
	return nodes.some(
		(node) => node.id !== renamed.id && nodeAuthored(node) && nodeName(node) === name
	);
}

// One record per project. Not `graph:`, which a visitor's old per-node keys still start with
const GRAPH_PREFIX = 'canvas:';

function graphKey(projectId: string) {
	return `${GRAPH_PREFIX}${projectId}`;
}

// Every project's nodes share one VFS, so a boot restores them all - a database in a project
// not on screen still spends the wait. Read from storage, not a GraphState, for the same reason.
// Postgres specifically, not every resource that stores something: its files are the ones
// heavy enough to explain a slow boot
export function anyPostgresNodes(): boolean {
	return readByPrefix<StoredGraph>(GRAPH_PREFIX).some(({ nodes }) =>
		nodes.some((node) => node.type === ('postgres' satisfies ResourceType))
	);
}

// A config the schema has outgrown costs its settings rather than the node
export function parseStoredConfig(definition: ResourceDefinition, config: unknown) {
	const parsed = definition.configSchema.safeParse(config);
	return parsed.success ? parsed.data : definition.configSchema.parse({});
}

// A stored config is re-parsed against the current schema: new options arrive at their
// defaults, unused ones are pruned, and a resource type that no longer exists takes its node
function loadNode(node: Node): Node | undefined {
	const definition = resourceDefinitions[node.type as ResourceType];
	if (!definition || !node.data) return undefined;
	(node.data as NodeData).config = parseStoredConfig(definition, (node.data as NodeData).config);
	return node;
}

type Graph = { nodes: Node[]; edges: Edge[] };

type StoredNode = Pick<Node, 'id' | 'type' | 'position' | 'data' | 'deletable' | 'origin'>;
type StoredEdge = Pick<Edge, 'id' | 'source' | 'target'>;
type StoredGraph = { nodes: StoredNode[]; edges: StoredEdge[] };

// Not through a GraphState: a project that is not open has none, and building one for it would
// take the container's active project with it
export function readGraph(projectId: string): Graph {
	const stored = readEntry<StoredGraph>(graphKey(projectId)) ?? { nodes: [], edges: [] };
	const nodes = stored.nodes.flatMap((node) => loadNode(node) ?? []);
	const has = (id: string) => nodes.some((node) => node.id === id);
	// An edge to a node that did not load would be drawn into empty space
	const edges = stored.edges.filter((edge) => has(edge.source) && has(edge.target));
	return { nodes, edges };
}

// Written whole, so no reader ever finds half a graph
export function writeGraph(projectId: string, { nodes, edges }: Graph) {
	const stored: StoredGraph = { nodes: nodes.map(storedNode), edges: edges.map(storedEdge) };
	localStorage.setItem(graphKey(projectId), JSON.stringify(stored));
}

// Only what a load needs back: selection, measurements and drag state are the flow's own
function storedNode({ id, type, position, data, deletable, origin }: Node): StoredNode {
	return { id, type, position, data, deletable, origin };
}

function storedEdge({ id, source, target }: Edge): StoredEdge {
	return { id, source, target };
}

export function deleteGraph(projectId: string) {
	localStorage.removeItem(graphKey(projectId));
}

export type NodeOptions = Pick<NodeData, 'files' | 'code' | 'chart' | 'testEvent' | 'authored'> & {
	// config arrives unparsed, so it is not NodeData's own
	config?: Record<string, unknown>;
	deletable?: boolean;
};

// Anything not supplied falls back to the schema's default
export function buildNode(
	type: ResourceType,
	position: { x: number; y: number },
	{ files, code, config, chart, testEvent, authored, deletable = true }: NodeOptions = {}
): StoredNode {
	const definition = getResourceDefinition(type);
	const data: NodeData = {
		config: definition.configSchema.parse(config ?? {}),
		ports: [],
		files,
		// A document is anyone's text: it can carry code for a resource the reader never writes
		code: definition.hasEditableFiles ? code : undefined,
		chart,
		testEvent,
		authored
	};
	return {
		id: nanoid(8),
		type,
		position,
		data,
		deletable,
		origin: [0.5, 0.5]
	};
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
	readonly projectId: string;

	constructor(projectId: string) {
		this.projectId = projectId;
		setActiveProject(projectId);
		({ nodes: this.nodes, edges: this.edges } = readGraph(projectId));
		// Also asked for on load, since a template's nodes are added just before the reload that
		// opens the project, and that navigation would dismiss Firefox's prompt
		if (this.nodes.some((node) => ownsStoredData(node.type))) void requestPersistentStorage();
	}

	addNode(type: ResourceType, position: { x: number; y: number }, options: NodeOptions = {}) {
		// Not awaited: on Firefox this prompts, and adding a node shouldn't wait on an answer
		if (ownsStoredData(type)) void requestPersistentStorage();
		const node = buildNode(type, position, options);
		this.nodes = [...this.nodes, node];
		this.save();
		return node;
	}

	addEdge(source: string, target: string) {
		const edge: Edge = { id: nanoid(8), source, target };
		this.edges = [...this.edges, edge];
		this.save();
		return edge;
	}

	getNode(id: string) {
		return this.nodes.find((node) => node.id === id);
	}

	// No id deselects everything. Nodes that were already right keep their identity, so the flow
	// reconciles only what changed
	select(id?: string) {
		this.nodes = this.nodes.map((node) => {
			const selected = node.id === id;
			return !!node.selected === selected ? node : { ...node, selected };
		});
	}

	// The config is snapshotted because callers pass a live form object they keep editing
	updateNodeConfig(id: string, config: Record<string, unknown>) {
		this.#patchNodeData(id, { config: $state.snapshot(config) });
	}

	// Called from event and reconcile contexts, never during reads, so replacing state is safe
	setNodePorts(id: string, ports: number[]) {
		this.#patchNodeData(id, { ports });
	}

	setNodeChart(id: string, chart: string | undefined) {
		this.#patchNodeData(id, { chart });
	}

	setNodeTestEvent(id: string, testEvent: string) {
		this.#patchNodeData(id, { testEvent });
	}

	#patchNodeData(id: string, patch: Partial<NodeData>) {
		const node = this.getNode(id);
		if (!node) return;
		const updated = { ...node, data: { ...(node.data as NodeData), ...patch } };
		this.nodes = this.nodes.map((existing) => (existing.id === id ? updated : existing));
		this.save();
	}

	// The flow updates its bound nodes and edges before its handlers run, so they call this after
	save() {
		writeGraph(this.projectId, { nodes: this.nodes, edges: this.edges });
	}
}

const graphContext = createContext<GraphState>('GRAPH');

export function setGraphState(projectId: string) {
	return graphContext.set(new GraphState(projectId));
}

export const getGraphState = graphContext.get;
