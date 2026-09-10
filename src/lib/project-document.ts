import type { Edge, Node } from '@xyflow/svelte';
import type { DirEnt } from '@vivari/core';
import { z } from 'zod';
import { resourceDefinitions, type ResourceType } from './resources';
import {
	nodeChart,
	nodeConfig,
	nodeTestEvent,
	parseStoredConfig,
	type GraphState
} from './graph-state.svelte';

export const PROJECT_FORMAT = 'gg:project/1';

// Path -> contents, so an exported project reads and edits as plain text
const nodeFilesSchema = z.record(z.string(), z.string());
export type NodeFiles = z.infer<typeof nodeFilesSchema>;

const projectDocumentSchema = z.object({
	format: z.literal(PROJECT_FORMAT),
	name: z.string().min(1),
	nodes: z.array(
		z.object({
			id: z.string(),
			type: z.enum(Object.keys(resourceDefinitions) as [ResourceType, ...ResourceType[]]),
			position: z.object({ x: z.number(), y: z.number() }),
			config: z.record(z.string(), z.unknown()),
			chart: z.string().optional(),
			testEvent: z.string().optional()
		})
	),
	edges: z.array(z.object({ source: z.string(), target: z.string() })),
	nodeFiles: z.record(z.string(), nodeFilesSchema)
});

export type ProjectDocument = z.infer<typeof projectDocumentSchema>;

export function buildProjectDocument(
	name: string,
	nodes: Node[],
	edges: Edge[],
	nodeFiles: Record<string, NodeFiles>
): string {
	const doc: ProjectDocument = {
		format: PROJECT_FORMAT,
		name,
		nodes: nodes.map((node) => ({
			id: node.id,
			type: node.type as ResourceType,
			position: node.position,
			config: nodeConfig(node),
			chart: nodeChart(node),
			testEvent: nodeTestEvent(node)
		})),
		edges: edges.map(({ source, target }) => ({ source, target })),
		nodeFiles
	};
	return JSON.stringify(doc, null, '\t');
}

export function parseProjectDocument(text: string): ProjectDocument {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new Error('That file is not a Glass Garden project');
	}
	const parsed = projectDocumentSchema.safeParse(raw);
	if (parsed.success) return parsed.data;
	const format = (raw as { format?: unknown })?.format;
	throw new Error(
		typeof format === 'string' && format.startsWith('gg:project/')
			? 'That project was made by a newer version of Glass Garden'
			: 'That file is not a Glass Garden project'
	);
}

// Ids are minted fresh so a project can be imported beside its own export; returns old → new
export function applyProjectDocument(graph: GraphState, doc: ProjectDocument) {
	const ids = new Map<string, string>();
	for (const node of doc.nodes) {
		const added = graph.addNode(node.type, node.position, {
			config: parseStoredConfig(resourceDefinitions[node.type], node.config),
			chart: node.chart,
			testEvent: node.testEvent
		});
		ids.set(node.id, added.id);
	}
	for (const edge of doc.edges) {
		const source = ids.get(edge.source);
		const target = ids.get(edge.target);
		if (source && target) graph.addEdge(source, target);
	}
	return ids;
}

export type ReadableFs = {
	readdir(path: string, options: { withFileTypes: true }): Promise<DirEnt[]>;
	readFile(path: string): Promise<Uint8Array>;
};

const decoder = new TextDecoder('utf-8', { fatal: true });

// Text files only, and nothing npm install produces: a start reinstalls them
export async function readNodeFiles(
	fs: ReadableFs,
	directory: string,
	prefix = ''
): Promise<NodeFiles> {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const files: NodeFiles = {};
	await Promise.all(
		entries.map(async (entry) => {
			if (entry.name === 'node_modules' || entry.name === 'package-lock.json') return;
			const path = `${directory}/${entry.name}`;
			if (entry.isDirectory()) {
				Object.assign(files, await readNodeFiles(fs, path, `${prefix}${entry.name}/`));
			} else if (entry.isFile()) {
				try {
					files[`${prefix}${entry.name}`] = decoder.decode(await fs.readFile(path));
				} catch {
					// Binary; left out
				}
			}
		})
	);
	return files;
}
