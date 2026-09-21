import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Node } from '@xyflow/svelte';
import { GraphState, nodeConfig, nodeTestEvent } from '$lib/graph-state.svelte';
import {
	CHALLENGE_FORMAT,
	PROJECT_FORMAT,
	applyCanvasDocument,
	buildProjectDocument,
	documentName,
	parseDocument,
	readNodeFiles,
	treeFiles,
	type ProjectDocument,
	type ReadableFs
} from '$lib/project-document';

vi.mock('$lib/container', () => ({
	requestPersistentStorage: vi.fn(),
	setActiveProject: vi.fn()
}));
vi.mock('$lib/resources', async () => {
	const { z } = await import('zod');
	const definition = {
		name: 'Test resource',
		ownsStoredData: false,
		configSchema: z.object({
			name: z.string().default('Test resource'),
			count: z.number().default(1)
		})
	};
	return {
		resourceDefinitions: { test: definition },
		resourceTypeSchema: z.enum(['test']),
		getResourceDefinition: () => definition
	};
});

function makeLocalStorage(): Storage {
	const entries = new Map<string, string>();
	return {
		get length() {
			return entries.size;
		},
		key: (index: number) => [...entries.keys()][index] ?? null,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => void entries.set(key, String(value)),
		removeItem: (key: string) => void entries.delete(key),
		clear: () => entries.clear()
	};
}

beforeEach(() => {
	globalThis.localStorage = makeLocalStorage();
});

const node = (id: string, extra: Partial<Node> = {}): Node => ({
	id,
	type: 'test',
	position: { x: 1, y: 2 },
	data: { config: { name: id, count: 2 }, ports: [3001], chart: 'requests', testEvent: '{}' },
	origin: [0.5, 0.5],
	selected: true,
	measured: { width: 10, height: 10 },
	...extra
});

// Loosely typed: the tests bend it past what the schema allows
const document = (): { nodes: Record<string, unknown>[]; [key: string]: unknown } => ({
	format: PROJECT_FORMAT,
	name: 'Lab',
	nodes: [
		{
			id: 'a',
			type: 'test',
			position: { x: 0, y: 0 },
			config: { name: 'A', count: 5 },
			testEvent: '{"hello":"world"}'
		},
		{ id: 'b', type: 'test', position: { x: 1, y: 1 }, config: { name: 'B' } }
	],
	edges: [
		{ source: 'a', target: 'b' },
		{ source: 'a', target: 'missing' }
	],
	nodeFiles: { a: { 'server.js': 'hi' } }
});

describe('buildProjectDocument', () => {
	it('keeps the definition and drops runtime and canvas state', () => {
		const doc = parseProject(
			buildProjectDocument(
				'Lab',
				[node('a'), node('b')],
				[{ id: 'e', source: 'a', target: 'b', selected: true }],
				{ a: { 'server.js': 'hi' } }
			)
		);
		expect(doc.nodes[0]).toEqual({
			id: 'a',
			type: 'test',
			position: { x: 1, y: 2 },
			config: { name: 'a', count: 2 },
			chart: 'requests',
			testEvent: '{}'
		});
		expect(doc.edges).toEqual([{ source: 'a', target: 'b' }]);
	});
});

// Loosely typed like `document()`, so the tests can bend it past what the schema allows
const challengeDocument = () => ({
	format: CHALLENGE_FORMAT,
	title: 'Survive a lost app',
	length: 30,
	events: [{ at: 5, stop: { name: 'B' } }] as unknown[],
	fixed: [] as unknown[],
	goals: {
		g: {
			title: 'Wired',
			conditions: [{ edge: { from: { name: 'A' }, to: { name: 'B' } } }] as unknown[]
		}
	} as Record<string, { title: string; conditions: unknown[] }>,
	startingCanvas: document()
});

// The tests that build a canvas want a project, which the parser does not promise
function parseProject(text: string): ProjectDocument {
	const doc = parseDocument(text);
	if (doc.format !== PROJECT_FORMAT) throw new Error(`expected a project, got ${doc.format}`);
	return doc;
}

describe('parseDocument', () => {
	it('reads a challenge with the canvas it starts from', () => {
		const doc = parseDocument(JSON.stringify(challengeDocument()));
		expect(doc.format).toBe(CHALLENGE_FORMAT);
		expect(documentName(doc)).toBe('Survive a lost app');
		if (doc.format === CHALLENGE_FORMAT) expect(doc.startingCanvas.nodes).toHaveLength(2);
	});

	it('rejects a challenge whose canvas has two nodes of one name', () => {
		const doc = challengeDocument();
		doc.startingCanvas.nodes[1].config = { name: 'A' };
		expect(() => parseDocument(JSON.stringify(doc))).toThrow('Two of the challenge');
		// The name a node falls back to counts, so two unnamed nodes collide the same way
		const unnamed = challengeDocument();
		for (const node of unnamed.startingCanvas.nodes) node.config = {};
		expect(() => parseDocument(JSON.stringify(unnamed))).toThrow('called "Test resource"');
	});

	// A goal whose only condition wires A to whatever is given
	const wiredTo = (to: unknown) => {
		const doc = challengeDocument();
		doc.goals.g.conditions = [{ edge: { from: { name: 'A' }, to } }];
		return doc;
	};

	it('rejects a name no node on the challenge canvas answers to', () => {
		expect(() => parseDocument(JSON.stringify(wiredTo({ name: 'Bee' })))).toThrow(
			'The goal "Wired" names a node called "Bee"'
		);
		const event = challengeDocument();
		event.events = [{ at: 5, stop: { name: 'Ghost' } }];
		expect(() => parseDocument(JSON.stringify(event))).toThrow('The event at 5 s names a node');
		// A type is the reader's to supply, so it is not checked against the canvas
		expect(parseDocument(JSON.stringify(wiredTo({ type: 'test' }))).format).toBe(CHALLENGE_FORMAT);
	});

	it('rejects a set event the node would ignore or refuse', () => {
		const set = (config: Record<string, unknown>) => {
			const doc = challengeDocument();
			doc.events = [{ at: 5, set: { node: { name: 'A' }, config } }];
			return () => parseDocument(JSON.stringify(doc));
		};
		expect(set({ count: 3 })().format).toBe(CHALLENGE_FORMAT);
		expect(set({ nope: 1 })).toThrow('sets "nope" on "A", which is not one of its settings');
		expect(set({ count: 'three' })).toThrow('sets "count" on "A" to a value it refuses');
	});

	it('rejects a goal comparing a setting the node could never satisfy', () => {
		const compares = (config: Record<string, unknown>) => {
			const doc = challengeDocument();
			doc.goals.g.conditions = [{ node: { ref: { name: 'A' }, config } }];
			return () => parseDocument(JSON.stringify(doc));
		};
		expect(compares({ count: { gte: 2 } })().format).toBe(CHALLENGE_FORMAT);
		expect(compares({ nope: { gte: 2 } })).toThrow(
			'The goal "Wired" compares "nope" on "A", which is not one of its settings'
		);
		expect(compares({ count: { eq: 'five' } })).toThrow('against a value the setting refuses');
		expect(compares({ name: { gte: 2 } })).toThrow('with gte or lte, but it is not a number');
		// A type's settings are the reader's
		const byType = challengeDocument();
		byType.goals.g.conditions = [{ node: { ref: { type: 'test' }, config: { nope: { gte: 2 } } } }];
		expect(parseDocument(JSON.stringify(byType)).format).toBe(CHALLENGE_FORMAT);
	});

	it('rejects a starting canvas the resource would refuse, rather than resetting it', () => {
		const doc = challengeDocument();
		doc.startingCanvas.nodes[0].config = { name: 'A', count: 'five' };
		expect(() => parseDocument(JSON.stringify(doc))).toThrow(
			'The challenge\'s canvas sets "count" on "A" to a value it refuses'
		);
		// A node with no name of its own is named by its resource
		const unnamed = challengeDocument();
		unnamed.startingCanvas.nodes[0].config = { count: 'five' };
		expect(() => parseDocument(JSON.stringify(unnamed))).toThrow('on a Test resource node');
	});

	// The whole fixed entry, so a case can name a node the canvas does not have
	const withFixed = (entry: Record<string, unknown>, goalConfig?: Record<string, unknown>) => {
		const doc = challengeDocument();
		doc.fixed = [entry];
		if (goalConfig) doc.goals.g.conditions = [{ node: { ref: { name: 'A' }, config: goalConfig } }];
		return parseDocument(JSON.stringify(doc));
	};
	const onA = (rest: Record<string, unknown> = {}) => ({ node: { name: 'A' }, ...rest });

	it('rejects a fixed setting the node does not have, from either list', () => {
		expect(withFixed(onA()).format).toBe(CHALLENGE_FORMAT);
		expect(withFixed(onA({ include: ['count'] })).format).toBe(CHALLENGE_FORMAT);
		expect(() => withFixed(onA({ include: ['nope'] }))).toThrow(
			'fixes "nope" on "A", which is not one of its settings'
		);
		expect(() => withFixed(onA({ exclude: ['nope'] }))).toThrow(
			'leaves "nope" on "A" to the reader, which is not one of its settings'
		);
		// The same walk that checks a goal's node, so a name with no node is caught here too
		expect(() => withFixed({ node: { name: 'Ghost' } })).toThrow(
			'The settings fixed on "Ghost" names a node'
		);
	});

	it('rejects fixing a setting a goal asks the reader to change', () => {
		const compares = { count: { gte: 2 } };
		expect(() => withFixed(onA({ include: ['count'] }), compares)).toThrow(
			'fixes "count" on "A", but a goal asks the reader to change it'
		);
		// The whole node and exclude both hand it back silently, which is what those forms mean
		expect(withFixed(onA(), compares).format).toBe(CHALLENGE_FORMAT);
	});

	it('rejects a challenge with no goals or no canvas', () => {
		const noGoals = { ...challengeDocument(), goals: {} };
		const { startingCanvas: _canvas, ...noCanvas } = challengeDocument();
		expect(() => parseDocument(JSON.stringify(noGoals))).toThrow();
		expect(() => parseDocument(JSON.stringify(noCanvas))).toThrow();
	});

	it('rejects what is not a project', () => {
		expect(() => parseDocument('not json')).toThrow('not a Glass Garden project');
		expect(() => parseDocument('{"format":"gg:metric/1"}')).toThrow('not a Glass Garden project');
	});

	it('rejects a newer format or an unknown resource type', () => {
		expect(() => parseDocument('{"format":"gg:project/2"}')).toThrow(
			'That project was made by a newer version'
		);
		const doc = document();
		doc.nodes[0].type = 'hologram';
		expect(() => parseDocument(JSON.stringify(doc))).toThrow('newer version');
		// Wherever the document names one, a goal included
		expect(() => parseDocument(JSON.stringify(wiredTo({ type: 'hologram' })))).toThrow(
			'newer version'
		);
		// A type left out is the author writing it wrong, not a build that has moved on
		expect(() => parseDocument(JSON.stringify(wiredTo({})))).toThrow('Invalid');
	});

	it('calls a challenge a challenge when it cannot be opened', () => {
		expect(() => parseDocument('{"format":"gg:challenge/2"}')).toThrow(
			'That challenge was made by a newer version'
		);
		const doc = challengeDocument();
		doc.startingCanvas.nodes[0].type = 'hologram';
		expect(() => parseDocument(JSON.stringify(doc))).toThrow('That challenge was made by');
	});
});

describe('applyCanvasDocument', () => {
	it('mints fresh ids and remaps edges through them', () => {
		const graph = new GraphState('p1');
		const ids = applyCanvasDocument(graph, parseProject(JSON.stringify(document())));
		expect(ids.get('a')).not.toBe('a');
		expect(graph.nodes.map((n) => n.id)).toEqual([ids.get('a'), ids.get('b')]);
		expect(graph.edges.map(({ source, target }) => [source, target])).toEqual([
			[ids.get('a'), ids.get('b')]
		]);
		expect(nodeConfig(graph.nodes[0])).toEqual({ name: 'A', count: 5 });
		expect(nodeTestEvent(graph.nodes[0])).toBe('{"hello":"world"}');
	});

	it('falls back to defaults for a config the schema rejects', () => {
		const doc = document();
		doc.nodes[0].config = { name: 'A', count: 'five' };
		const graph = new GraphState('p1');
		applyCanvasDocument(graph, parseProject(JSON.stringify(doc)));
		expect(nodeConfig(graph.nodes[0])).toEqual({ name: 'Test resource', count: 1 });
	});
});

describe('readNodeFiles', () => {
	it('walks text files, skipping install output and binaries', async () => {
		const tree: Record<string, Record<string, Uint8Array | null>> = {
			'/n': {
				'server.js': new TextEncoder().encode('hi'),
				lib: null,
				node_modules: null,
				'package-lock.json': new TextEncoder().encode('{}'),
				'blob.bin': new Uint8Array([0xff, 0xfe])
			},
			'/n/lib': { 'util.js': new TextEncoder().encode('util') },
			'/n/node_modules': { 'dep.js': new TextEncoder().encode('dep') }
		};
		const fs: ReadableFs = {
			readdir: async (path) =>
				Object.entries(tree[path]).map(([name, bytes]) => ({
					name,
					isDirectory: () => bytes === null,
					isFile: () => bytes !== null
				})),
			readFile: async (path) => {
				const slash = path.lastIndexOf('/');
				return tree[path.slice(0, slash)][path.slice(slash + 1)]!;
			}
		};
		expect(await readNodeFiles(fs, '/n')).toEqual({ 'server.js': 'hi', 'lib/util.js': 'util' });
	});
});

describe('treeFiles', () => {
	it('flattens a file tree to paths, leaving out bytes', () => {
		expect(
			treeFiles({
				'server.js': { file: { contents: 'hi' } },
				lib: { directory: { 'util.js': { file: { contents: 'util' } } } },
				'blob.bin': { file: { contents: new Uint8Array([0xff]) } }
			})
		).toEqual({ 'server.js': 'hi', 'lib/util.js': 'util' });
	});
});
