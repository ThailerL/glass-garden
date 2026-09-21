import type { Edge, Node } from '@xyflow/svelte';
import type { DirEnt, FileSystemTree } from '@vivari/core';
import { z } from 'zod';
import {
	declaredReads,
	resourceDefinitions,
	resourceTypeSchema,
	type ResourceType
} from './resources';
import {
	challengeRefs,
	challengeSchema,
	comparedSettings,
	dataCondition,
	neededNodes,
	readProblem,
	type Challenge,
	type Comparison,
	type FixedNode,
	type ScriptEvent
} from './challenge';
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

const canvasNodeSchema = z.object({
	id: z.string(),
	type: resourceTypeSchema,
	position: z.object({ x: z.number(), y: z.number() }),
	config: z.record(z.string(), z.unknown()),
	chart: z.string().optional(),
	testEvent: z.string().optional()
});

export type CanvasDocumentNode = z.infer<typeof canvasNodeSchema>;

const projectDocumentSchema = z.object({
	format: z.literal(PROJECT_FORMAT),
	name: z.string().min(1),
	nodes: z.array(canvasNodeSchema),
	edges: z.array(z.object({ source: z.string(), target: z.string() })),
	nodeFiles: z.record(z.string(), nodeFilesSchema)
});

export type ProjectDocument = z.infer<typeof projectDocumentSchema>;

// What a canvas laid onto a graph needs. A challenge's title names it, so its starting canvas
// carries no name of its own
const canvasDocumentSchema = projectDocumentSchema.omit({ name: true });
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;

export const CHALLENGE_FORMAT = 'gg:challenge/1';

// A challenge holds the canvas it starts from rather than riding on a project, so what is
// shared is always the challenge as written, never a reader's progress through it
const challengeDocumentSchema = challengeSchema
	.extend({
		format: z.literal(CHALLENGE_FORMAT),
		// Where an editor looks up the format to check the file as it is typed; the app reads
		// the format tag instead
		$schema: z.string().optional(),
		title: z.string().min(1),
		// What the card says to someone who has not opened it; instructions stand in the panel
		// of the open challenge, where the reader is doing the work
		description: z.string().min(1).optional(),
		instructions: z.array(z.string().min(1)).min(1).optional(),
		startingCanvas: canvasDocumentSchema
	})
	// The document holds the canvas its goals and events talk about, so every reference into it
	// is checked here rather than failing silently in a run nobody can win
	.superRefine((challenge, ctx) => {
		const problem = (message: string) => ctx.addIssue({ code: 'custom', message });
		const canvas = canvasByName(challenge.startingCanvas, problem);
		for (const { where, ref, config, data } of challengeRefs(challenge)) {
			// A type is the node the reader supplies, so neither it nor its settings are ours to check
			if (!('name' in ref)) continue;
			const target = canvas.get(ref.name);
			if (!target) {
				problem(
					`${where} names a node called "${ref.name}", which the challenge's canvas does not have`
				);
				continue;
			}
			const unreadable = data && readProblem(target.type, data);
			if (unreadable) {
				problem(`${where} asks "${ref.name}" for a read it cannot answer: ${unreadable}`);
			}
			for (const [key, comparison] of Object.entries(config ?? {})) {
				checkComparison({ where, key, comparison }, ref.name, target, problem);
			}
		}
		for (const event of challenge.events) {
			if ('set' in event) checkSetEvent(event, canvas, problem);
		}
		const compared = comparedSettings(challenge);
		for (const fixed of challenge.fixed) {
			checkFixedSettings(fixed, canvas, compared.get(fixed.node.name), problem);
		}
	});

type NamedNode = { type: ResourceType; config: Record<string, unknown> };

// The name each node lands on, defaults and all, rather than the one it was written with.
// Two of a name would be one reference meaning both, so the second is refused. A refused
// setting is reported rather than reset, which would take the node's name down with it
function canvasByName(starting: CanvasDocument, problem: (message: string) => void) {
	const canvas = new Map<string, NamedNode>();
	for (const node of starting.nodes) {
		const definition = resourceDefinitions[node.type];
		const parsed = definition.configSchema.safeParse(node.config);
		if (!parsed.success) {
			const { path } = parsed.error.issues[0];
			const named =
				typeof node.config.name === 'string'
					? `"${node.config.name}"`
					: `a ${definition.name} node`;
			problem(`The challenge's canvas sets "${path.join('.')}" on ${named} to a value it refuses`);
			continue;
		}
		const config = parsed.data;
		const name = config.name as string;
		if (canvas.has(name)) {
			problem(
				`Two of the challenge's nodes are called "${name}", so a goal naming it would mean both`
			);
			continue;
		}
		canvas.set(name, { type: node.type, config });
	}
	return canvas;
}

// A setting the node does not have is dropped on the way in, so a script's typo would change
// nothing and say nothing. Checked against the canvas as shipped, which is the best the
// document can know: the reader may have changed a setting before the run reaches this event
function checkSetEvent(
	event: Extract<ScriptEvent, { set: unknown }>,
	canvas: Map<string, NamedNode>,
	problem: (message: string) => void
) {
	const { name } = event.set.node;
	const target = canvas.get(name);
	if (!target) return;
	const { configSchema } = resourceDefinitions[target.type];
	for (const key of Object.keys(event.set.config)) {
		if (key in configSchema.shape) continue;
		problem(
			`The event at ${event.at} s sets "${key}" on "${name}", which is not one of its settings`
		);
	}
	const parsed = configSchema.safeParse({ ...target.config, ...event.set.config });
	if (parsed.success) return;
	const { path } = parsed.error.issues[0];
	problem(`The event at ${event.at} s sets "${path.join('.')}" on "${name}" to a value it refuses`);
}

// A misspelt setting reads as protection the reader does not get, or as a knob left to them
// that never appears. A node named with neither list takes every setting, so there is nothing
// to check
function checkFixedSettings(
	{ node, include, exclude }: FixedNode,
	canvas: Map<string, NamedNode>,
	compared: Set<string> | undefined,
	problem: (message: string) => void
) {
	const target = canvas.get(node.name);
	if (!target) return;
	const { configSchema } = resourceDefinitions[target.type];
	// Only one list can be given, so the other is empty; which one decides the wording
	for (const key of include ?? exclude ?? []) {
		if (key in configSchema.shape) continue;
		problem(
			include
				? `The challenge fixes "${key}" on "${node.name}", which is not one of its settings`
				: `The challenge leaves "${key}" on "${node.name}" to the reader, which is not one of its settings`
		);
	}
	// A goal comparing a setting hands it back to the reader, which would quietly undo this
	for (const key of include ?? []) {
		if (!compared?.has(key)) continue;
		problem(
			`The challenge fixes "${key}" on "${node.name}", but a goal asks the reader to change it`
		);
	}
}

// A comparison the setting can never satisfy is a goal no reader can meet. A bound holds only
// for a number, and a setting keeps its kind, so the shipped value says whether one could
function checkComparison(
	{ where, key, comparison }: { where: string; key: string; comparison: Comparison },
	name: string,
	target: NamedNode,
	problem: (message: string) => void
) {
	const { configSchema } = resourceDefinitions[target.type];
	if (!(key in configSchema.shape)) {
		problem(`${where} compares "${key}" on "${name}", which is not one of its settings`);
		return;
	}
	const { eq, gte, lte } = comparison;
	if (eq !== undefined && !configSchema.safeParse({ ...target.config, [key]: eq }).success) {
		problem(`${where} compares "${key}" on "${name}" against a value the setting refuses`);
	}
	if ((gte ?? lte) === undefined || typeof target.config[key] === 'number') return;
	problem(`${where} compares "${key}" on "${name}" with gte or lte, but it is not a number`);
}

export type ChallengeDocument = z.infer<typeof challengeDocumentSchema>;

// A challenge's nodes are named, and a reader cannot rename one, so a name is the same node in
// any version of the document. The name a node lands on, defaults and all, is the one that counts
export function startingNodes(document: ChallengeDocument): Map<string, CanvasDocumentNode> {
	return new Map(
		document.startingCanvas.nodes.map((node) => {
			const config = parseStoredConfig(resourceDefinitions[node.type], node.config);
			return [config.name as string, { ...node, config }];
		})
	);
}

// How a run plays, as against what it is scored by: a goal met in a gentler script or a shorter
// run is not the same achievement, so a change here costs the whole best run
export function sameRunScript(before: ChallengeDocument, after: ChallengeDocument): boolean {
	const script = ({ length, events }: ChallengeDocument) => JSON.stringify({ length, events });
	return script(before) === script(after);
}

// Keyed rather than listed, so the order goals are written in is not a change at all
function judgedGoals(document: ChallengeDocument): Map<string, string> {
	return new Map(
		Object.entries(document.goals).map(([id, { title, hint, ...judged }]) => [
			id,
			JSON.stringify(judged)
		])
	);
}

// The goals two versions score the same way, by the key a run is scored by rather than the title
// a rewording moves. What a run met elsewhere is not what this version would call met
export function goalsJudgedAlike(before: ChallengeDocument, after: ChallengeDocument): Set<string> {
	const now = judgedGoals(after);
	const kept = [...judgedGoals(before)].filter(([id, goal]) => now.get(id) === goal);
	return new Set(kept.map(([id]) => id));
}

// A read is named by a string, and its arguments are whatever that read takes, so neither is
// anything an editor could offer. One arm per read the resources declare says both
function describeReads({
	zodSchema,
	jsonSchema
}: {
	zodSchema: unknown;
	jsonSchema: z.core.JSONSchema.BaseSchema;
}): void {
	if (zodSchema !== dataCondition) return;
	const reads = declaredReads();
	const named = jsonSchema.properties?.read;
	if (typeof named === 'object') named.enum = [...new Set(reads.map(({ name }) => name))];
	jsonSchema.anyOf = reads.map(({ name, read }) => {
		const args = z.toJSONSchema(read.args, { io: 'input' });
		// The arms are not documents of their own
		delete args.$schema;
		return {
			properties: { read: { const: name }, args },
			// A read that needs an argument cannot be asked without them
			required: args.required ? ['read', 'args'] : ['read']
		};
	});
}

// Shipped beside the challenges so an editor checks one as it is written. Only the shape
// survives the conversion; what the canvas references mean is still the parse's to say
export function challengeJsonSchema(): unknown {
	return z.toJSONSchema(challengeDocumentSchema, { io: 'input', override: describeReads });
}

// What a file, a share link or an embed can carry
export type GardenDocument = ProjectDocument | ChallengeDocument;

const gardenDocumentSchema = z.discriminatedUnion('format', [
	projectDocumentSchema,
	challengeDocumentSchema
]);

export function documentName(doc: GardenDocument): string {
	return doc.format === CHALLENGE_FORMAT ? doc.title : doc.name;
}

// What to call it to the reader. Taken from the format tag, so a document too new to parse is
// still called what it is
export function documentKind(doc: GardenDocument | string): 'challenge' | 'project' {
	const format = typeof doc === 'string' ? doc : doc.format;
	return format.startsWith('gg:challenge/') ? 'challenge' : 'project';
}

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

// Whatever the author put there, under keys the document does not read as its own structure
const FREE_FORM = ['config', 'dimensions', 'nodeFiles'];

// Asked of the document, not of the failure: a goal's reference sits inside a union, which
// reports a type we do not have and a type left out as the same failure. Free-form records are
// stepped over, so a setting or a dimension called "type" is not read as a resource type
function namesUnknownType(raw: unknown): boolean {
	if (Array.isArray(raw)) return raw.some(namesUnknownType);
	if (typeof raw !== 'object' || raw === null) return false;
	return Object.entries(raw).some(([key, value]) => {
		if (FREE_FORM.includes(key)) return false;
		return key === 'type' && typeof value === 'string'
			? !resourceTypeSchema.safeParse(value).success
			: namesUnknownType(value);
	});
}

export function parseDocument(text: string): GardenDocument {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new Error('That file is not a Glass Garden project');
	}
	const parsed = gardenDocumentSchema.safeParse(raw);
	if (parsed.success) return parsed.data;
	const format = (raw as { format?: unknown })?.format;
	const tag = typeof format === 'string' ? format : '';
	if (!/^gg:(project|challenge)\//.test(tag)) {
		throw new Error('That file is not a Glass Garden project');
	}
	// A tag this build writes itself is a format it understands, so the fault is the author's
	// and they are told which one. Our own checks say it in a sentence; zod says it with a path
	if (tag === PROJECT_FORMAT || tag === CHALLENGE_FORMAT) {
		const authored = parsed.error.issues.find((issue) => issue.code === 'custom');
		if (authored) throw new Error(authored.message);
		// Resource types grow between builds while the format tag stays put, so a type we do not
		// have is the one failure on a current tag that really is a newer version
		if (!namesUnknownType(raw)) throw new Error(z.prettifyError(parsed.error));
	}
	// Called what the reader was offered
	throw new Error(`That ${documentKind(tag)} was made by a newer version of Glass Garden`);
}

// Ids are minted fresh so a project can be imported beside its own export; returns old → new.
// A challenge's canvas is marked as authored, which is what lets its goals name these nodes
export function applyCanvasDocument(graph: GraphState, doc: CanvasDocument, challenge?: Challenge) {
	const needed = challenge && neededNodes(challenge);
	const ids = new Map<string, string>();
	for (const node of doc.nodes) {
		const config = parseStoredConfig(resourceDefinitions[node.type], node.config);
		const added = graph.addNode(node.type, node.position, {
			config,
			chart: node.chart,
			testEvent: node.testEvent,
			// Kept off an ordinary project's nodes rather than stored as false on every one
			authored: challenge ? true : undefined,
			deletable: !needed?.has(config.name as string)
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

export function treeFiles(tree: FileSystemTree, prefix = ''): NodeFiles {
	const files: NodeFiles = {};
	for (const [name, entry] of Object.entries(tree)) {
		if ('directory' in entry) {
			Object.assign(files, treeFiles(entry.directory, `${prefix}${name}/`));
		} else if (typeof entry.file.contents === 'string') {
			files[`${prefix}${name}`] = entry.file.contents;
		}
	}
	return files;
}
