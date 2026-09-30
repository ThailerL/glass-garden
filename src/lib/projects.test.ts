import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('$app/paths', () => ({ resolve: (route: string) => route }));
// The store's own imports plus graph-state's, which creating a project reaches through
vi.mock('$lib/container', () => ({
	getContainer: vi.fn(),
	nodeDirectory: vi.fn(),
	onContainerBoot: vi.fn(),
	projectDirectory: vi.fn(),
	PROJECTS_ROOT: '/projects',
	removeProjectFiles: vi.fn(),
	requestPersistentStorage: vi.fn(),
	setActiveProject: vi.fn()
}));

// Hoisted above the imports: the store reads storage as it loads, so it has to exist by then
vi.hoisted(() => {
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

import {
	createProject,
	ensureProject,
	importProject,
	listChallenges,
	listEmbedded,
	listProjects,
	resetChallenge
} from '$lib/projects.svelte';
import { readGraph, type NodeData } from '$lib/graph-state.svelte';
import { readByPrefix } from '$lib/storage';
import type { GardenDocument } from '$lib/project-document';

afterEach(() => {
	vi.restoreAllMocks();
});

// One test, since the store loads once and its records outlive a single case
describe('listProjects and listChallenges', () => {
	it('keeps a challenge out of the projects list, and never lands the reader on one', () => {
		const challenge = createProject('Keep up', () => {}, {
			challenge: { title: 'Keep up' } as never
		});
		expect(listProjects()).toEqual([]);
		expect(listChallenges().map((p) => p.id)).toEqual([challenge.id]);

		// Nothing but a challenge exists, so this makes a project rather than opening one
		const made = ensureProject();
		expect(made.challenge).toBeUndefined();
		expect(listProjects().map((p) => p.id)).toEqual([made.id]);
		expect(listChallenges().map((p) => p.id)).toEqual([challenge.id]);
	});
});

const document = {
	format: 'gg:challenge/1',
	title: 'Keep up',
	length: 10,
	events: [],
	fixed: [],
	goals: [{ id: 'up', title: 'Up', conditions: [{ exists: { node: { type: 'sqsQueue' } } }] }],
	startingCanvas: { format: 'gg:project/1', nodes: [], edges: [], nodeFiles: {} }
} as never;

describe('resetChallenge', () => {
	it('hands the fresh project everything that outlives the canvas', () => {
		const started = importProject(document, { builtIn: 'keep-up', embedHash: '#garden=abc' });
		started.bestRun = ['up'];

		const fresh = resetChallenge(started);
		expect(fresh.id).not.toBe(started.id);
		// The embed's link among them, so the frame finds the replacement without being told
		expect(fresh).toMatchObject({
			builtIn: 'keep-up',
			embedHash: '#garden=abc',
			bestRun: ['up']
		});
		expect(listEmbedded().map((p) => p.id)).toEqual([fresh.id]);
	});
});

describe('importProject', () => {
	const doc = (type: string, nodeFiles: Record<string, Record<string, string>>) =>
		({
			format: 'gg:project/1',
			name: 'Imported',
			nodes: [{ id: 'written', type, position: { x: 0, y: 0 }, config: {} }],
			edges: [],
			nodeFiles
		}) as GardenDocument;

	const codeOf = (projectId: string) =>
		readGraph(projectId).nodes.map((node) => (node.data as NodeData).code);

	it("keeps a node's code on the stored node, so it lasts exactly as long as the node", () => {
		const project = importProject(doc('instanceGroup', { written: { 'server.js': 'authored' } }));

		expect(codeOf(project.id)).toEqual([{ 'server.js': 'authored' }]);
	});

	it('ignores files written for a node the document never placed', () => {
		const project = importProject(doc('instanceGroup', { absent: { 'server.js': 'orphan' } }));

		expect(codeOf(project.id)).toEqual([undefined]);
	});

	// The region provisions this one from files of ours, which a document does not get to replace
	it('ignores files written for a resource the reader does not write', () => {
		const project = importProject(doc('dynamodbTable', { written: { 'server.js': 'theirs' } }));

		expect(codeOf(project.id)).toEqual([undefined]);
	});

	it.each(['canvas', 'project'])(
		'lists nothing and keeps no graph when writing %s fails',
		(failing) => {
			const listed = listProjects().length;
			const graphs = readByPrefix('canvas:');
			const setItem = localStorage.setItem.bind(localStorage);
			vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
				if (key.startsWith(`${failing}:`)) throw new DOMException('full', 'QuotaExceededError');
				setItem(key, value);
			});

			expect(() =>
				importProject(doc('instanceGroup', { written: { 'server.js': 'authored' } }))
			).toThrow('full');

			expect(listProjects()).toHaveLength(listed);
			expect(readByPrefix('canvas:')).toEqual(graphs);
		}
	);
});
