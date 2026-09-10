import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Node } from '@xyflow/svelte';
import { GraphState, nodeConfig, nodeTestEvent } from '$lib/graph-state.svelte';
import {
	PROJECT_FORMAT,
	applyProjectDocument,
	buildProjectDocument,
	parseProjectDocument,
	readNodeFiles,
	treeFiles,
	type ReadableFs
} from '$lib/project-document';

vi.mock('$lib/container', () => ({
	requestPersistentStorage: vi.fn(),
	setActiveProject: vi.fn()
}));
vi.mock('$lib/resources', async () => {
	const { z } = await import('zod');
	const definition = {
		ownsStoredData: false,
		configSchema: z.object({
			name: z.string().default('Test resource'),
			count: z.number().default(1)
		})
	};
	return { resourceDefinitions: { test: definition }, getResourceDefinition: () => definition };
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
		const doc = parseProjectDocument(
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

describe('parseProjectDocument', () => {
	it('rejects what is not a project', () => {
		expect(() => parseProjectDocument('not json')).toThrow('not a Glass Garden project');
		expect(() => parseProjectDocument('{"format":"gg:metric/1"}')).toThrow(
			'not a Glass Garden project'
		);
	});

	it('rejects a newer format or an unknown resource type', () => {
		expect(() => parseProjectDocument('{"format":"gg:project/2"}')).toThrow('newer version');
		const doc = document();
		doc.nodes[0].type = 'hologram';
		expect(() => parseProjectDocument(JSON.stringify(doc))).toThrow('newer version');
	});
});

describe('applyProjectDocument', () => {
	it('mints fresh ids and remaps edges through them', () => {
		const graph = new GraphState('p1');
		const ids = applyProjectDocument(graph, parseProjectDocument(JSON.stringify(document())));
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
		applyProjectDocument(graph, parseProjectDocument(JSON.stringify(doc)));
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
