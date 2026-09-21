import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Edge, Node } from '@xyflow/svelte';
import {
	GraphState,
	graphKeyPrefix,
	nodeAuthored,
	nodeConfig,
	nodeName
} from '$lib/graph-state.svelte';
import { readByPrefix } from '$lib/storage';
import {
	applyCanvasDocument,
	CHALLENGE_FORMAT,
	PROJECT_FORMAT,
	parseDocument,
	type ChallengeDocument
} from '$lib/project-document';
import { mergeStartingCanvas } from '$lib/challenge-merge';

vi.mock('$lib/container', () => ({
	requestPersistentStorage: vi.fn(),
	setActiveProject: vi.fn()
}));
vi.mock('$lib/resources', async () => {
	const { z } = await import('zod');
	const definition = {
		name: 'Test resource',
		hasEditableFiles: false,
		configSchema: z.object({
			name: z.string().default('Test resource'),
			count: z.number().default(1)
		})
	};
	return {
		resourceDefinitions: { test: definition },
		resourceTypeSchema: z.enum(['test']),
		getResourceDefinition: () => definition,
		ownsStoredData: () => false
	};
});

beforeEach(() => {
	const entries = new Map<string, string>();
	globalThis.localStorage = {
		get length() {
			return entries.size;
		},
		key: (index: number) => [...entries.keys()][index] ?? null,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => void entries.set(key, String(value)),
		removeItem: (key: string) => void entries.delete(key),
		clear: () => entries.clear()
	};
});

const PROJECT = 'p1';

const shippedNode = (id: string, name: string, config: object = {}) => ({
	id,
	type: 'test',
	position: { x: 0, y: 0 },
	config: { name, ...config }
});

// A challenge of two nodes, unwired, with one goal that names neither end of an edge
const challenge = (fields: object = {}): ChallengeDocument => {
	const base = {
		format: CHALLENGE_FORMAT,
		title: 'Keep up',
		description: 'Two nodes and a goal',
		stack: 'Two nodes',
		instructions: ['Keep up.'],
		length: 30,
		events: [],
		fixed: [],
		goals: [{ id: 'g', title: 'There', conditions: [{ node: { name: 'A' } }] }],
		startingCanvas: {
			format: PROJECT_FORMAT,
			nodes: [shippedNode('a', 'A'), shippedNode('b', 'B')],
			edges: [],
			nodeFiles: {}
		}
	};
	const parsed = parseDocument(JSON.stringify({ ...base, ...fields }));
	if (parsed.format !== CHALLENGE_FORMAT) throw new Error('expected a challenge');
	return parsed;
};

// The canvas as import would have laid it down, which is what a reader starts on
function start(document: ChallengeDocument) {
	applyCanvasDocument(new GraphState(PROJECT), document.startingCanvas, document);
}

const readNodes = () =>
	readByPrefix<Node>(`${graphKeyPrefix(PROJECT)}node:`).sort((a, b) =>
		nodeName(a).localeCompare(nodeName(b))
	);
const named = (name: string) => readNodes().find((node) => nodeName(node) === name);

// Every edge on the canvas, by the names at its ends
const pairs = () =>
	readByPrefix<Edge>(`${graphKeyPrefix(PROJECT)}edge:`)
		.map((edge) => {
			const ends = [edge.source, edge.target].map((id) => readNodes().find((n) => n.id === id));
			return ends.map((node) => (node ? nodeName(node) : '?')).join(' -> ');
		})
		.sort();

// What the author owns on node A, so the merge has something it is allowed to write
const fixing = (config: object) => ({
	fixed: [{ node: { name: 'A' }, include: ['count'] }],
	startingCanvas: {
		format: PROJECT_FORMAT,
		nodes: [shippedNode('a', 'A', config), shippedNode('b', 'B')],
		edges: [],
		nodeFiles: {}
	}
});

describe('mergeStartingCanvas', () => {
	it('writes a fixed setting the author has changed, which no reader could have touched', () => {
		const before = challenge(fixing({ count: 2 }));
		start(before);

		expect(mergeStartingCanvas(PROJECT, before, challenge(fixing({ count: 5 })))).toBe(true);
		expect(nodeConfig(named('A')!)).toMatchObject({ count: 5 });
	});

	it('leaves a setting the reader owns at whatever they set it to', () => {
		start(challenge());
		// Nothing is fixed on B, so this is the reader's own tuning
		const graph = new GraphState(PROJECT);
		const b = graph.nodes.find((node) => nodeName(node) === 'B')!;
		graph.updateNodeConfig(b.id, { ...nodeConfig(b), count: 7 });

		const after = challenge({ ...fixing({ count: 4 }), title: 'Keep up, faster' });
		expect(mergeStartingCanvas(PROJECT, challenge(), after)).toBe(true);
		expect(nodeConfig(named('B')!)).toMatchObject({ count: 7 });
	});

	const threeNodes = {
		format: PROJECT_FORMAT,
		nodes: [shippedNode('a', 'A'), shippedNode('b', 'B'), shippedNode('c', 'C')],
		edges: [],
		nodeFiles: {}
	};

	it('gives the reader a node the author has added and a goal now names', () => {
		start(challenge());

		const grown = challenge({
			goals: [{ id: 'g', title: 'There', conditions: [{ node: { name: 'C' } }] }],
			startingCanvas: threeNodes
		});
		expect(mergeStartingCanvas(PROJECT, challenge(), grown)).toBe(true);
		const added = named('C');
		expect(added).toBeDefined();
		expect(nodeAuthored(added!)).toBe(true);
		expect(added!.deletable).toBe(false);
	});

	it('gives the reader a node the author has added even where nothing names it', () => {
		start(challenge());

		const grown = challenge({ startingCanvas: threeNodes });
		expect(mergeStartingCanvas(PROJECT, challenge(), grown)).toBe(true);
		expect(nodeAuthored(named('C')!)).toBe(true);
		expect(named('C')!.deletable).toBe(true);
	});

	it('leaves a node the reader deleted deleted, unless this version names it', () => {
		const before = challenge({ startingCanvas: threeNodes });
		start(before);
		const graph = new GraphState(PROJECT);
		graph.deleteNodeFromStorage(graph.nodes.find((node) => nodeName(node) === 'C')!.id);

		expect(mergeStartingCanvas(PROJECT, before, challenge({ startingCanvas: threeNodes }))).toBe(
			false
		);
		expect(named('C')).toBeUndefined();

		const names = challenge({
			goals: [{ id: 'g', title: 'There', conditions: [{ node: { name: 'C' } }] }],
			startingCanvas: threeNodes
		});
		expect(mergeStartingCanvas(PROJECT, before, names)).toBe(true);
		expect(named('C')!.deletable).toBe(false);
	});

	it('hands the reader a node the author has dropped, with their work on it', () => {
		const before = challenge({ startingCanvas: threeNodes });
		start(before);
		const graph = new GraphState(PROJECT);
		const c = graph.nodes.find((node) => nodeName(node) === 'C')!;
		graph.updateNodeConfig(c.id, { ...nodeConfig(c), count: 7 });

		expect(mergeStartingCanvas(PROJECT, before, challenge())).toBe(true);
		expect(nodeAuthored(named('C')!)).toBeFalsy();
		expect(named('C')!.deletable).toBe(true);
		expect(nodeConfig(named('C')!)).toMatchObject({ count: 7 });
	});

	it('follows the new version on which nodes may be deleted', () => {
		start(challenge());
		expect(named('B')!.deletable).toBe(true);

		// This version's event names B, so it becomes one the run cannot do without
		const holds = challenge({ events: [{ at: 5, stop: { name: 'B' } }] });
		expect(mergeStartingCanvas(PROJECT, challenge(), holds)).toBe(false);
		expect(named('B')!.deletable).toBe(false);
	});

	it('leaves every edge alone, since wiring is the reader’s whoever drew it', () => {
		const wired = (edges: object[]) => ({
			startingCanvas: {
				format: PROJECT_FORMAT,
				nodes: [shippedNode('a', 'A'), shippedNode('b', 'B'), shippedNode('c', 'C')],
				edges,
				nodeFiles: {}
			}
		});
		const before = challenge(wired([{ source: 'a', target: 'b' }]));
		start(before);

		// This version drops A -> B and ships B -> C, and neither reaches the canvas
		const after = challenge(wired([{ source: 'b', target: 'c' }]));
		expect(mergeStartingCanvas(PROJECT, before, after)).toBe(false);
		expect(pairs()).toEqual(['A -> B']);
	});

	it('reports nothing moved when the version changes only what it says', () => {
		start(challenge());
		expect(mergeStartingCanvas(PROJECT, challenge(), challenge({ title: 'Renamed' }))).toBe(false);
	});
});
