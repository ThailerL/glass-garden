import { describe, it, expect, vi } from 'vitest';

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
import { readImportedFiles } from '$lib/files/imported-files';
import { graphKeyPrefix } from '$lib/graph-state.svelte';
import { readByPrefix } from '$lib/storage';
import type { GardenDocument } from '$lib/project-document';
import type { Node } from '@xyflow/svelte';

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

// Nothing is mounted here: the import's reload would beat the kernel's persist
describe('importProject', () => {
	const doc = (type: string, nodeFiles: Record<string, Record<string, string>>) =>
		({
			format: 'gg:project/1',
			name: 'Imported',
			nodes: [{ id: 'written', type, position: { x: 0, y: 0 }, config: {} }],
			edges: [],
			nodeFiles
		}) as GardenDocument;

	const nodeIdsOf = (projectId: string) =>
		readByPrefix<Node>(`${graphKeyPrefix(projectId)}node:`).map((node) => node.id);

	it("holds a node's code under the id the canvas minted for it, not the document's", () => {
		const project = importProject(doc('instanceGroup', { written: { 'server.js': 'authored' } }));
		const [nodeId] = nodeIdsOf(project.id);

		expect(nodeId).not.toBe('written');
		expect(readImportedFiles(nodeId)).toEqual({ 'server.js': 'authored' });
		expect(readImportedFiles('written')).toBeUndefined();
	});

	it('ignores files written for a node the document never placed', () => {
		const project = importProject(doc('instanceGroup', { absent: { 'server.js': 'orphan' } }));

		expect(nodeIdsOf(project.id).map((id) => readImportedFiles(id))).toEqual([undefined]);
		expect(readImportedFiles('absent')).toBeUndefined();
	});

	// The region provisions this one from files of ours, which a document does not get to replace
	it('ignores files written for a resource the reader does not write', () => {
		const project = importProject(doc('dynamodbTable', { written: { 'server.js': 'theirs' } }));

		expect(nodeIdsOf(project.id).map((id) => readImportedFiles(id))).toEqual([undefined]);
	});
});
