import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChallengeFolder } from '$lib/challenges';

vi.mock('$app/paths', () => ({ resolve: (route: string) => route }));
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

// The folder itself is read elsewhere; what matters here is how a read one meets the records
const shipped = {
	format: 'gg:challenge/1',
	title: 'Keep up',
	length: 10,
	events: [],
	fixed: [],
	goals: { one: { title: 'One', conditions: [] }, two: { title: 'Two', conditions: [] } },
	startingCanvas: { format: 'gg:project/1', nodes: [], edges: [], nodeFiles: {} }
} as never;

const folder: ChallengeFolder = {
	challenges: [{ id: 'spike', stack: 'One node', document: shipped }],
	unread: [{ file: 'broken.json', problem: 'That file is not a Glass Garden project' }]
};
vi.mock('$lib/challenges', () => ({ loadChallengeFolder: vi.fn(async () => folder) }));

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

import { challengeCatalogue, loadCatalogue } from '$lib/challenge-catalogue.svelte';
import { createProject } from '$lib/projects.svelte';

const challenge = (name: string, fields: Record<string, unknown>) =>
	createProject(name, () => {}, {
		challenge: { ...(shipped as object), title: name } as never,
		...fields
	});

describe('challengeCatalogue', () => {
	beforeEach(async () => {
		loadCatalogue();
		// The folder lands a microtask later, and every reading below is of a loaded catalogue
		await vi.waitFor(() => expect(challengeCatalogue().ready).toBe(true));
	});

	it('puts a started challenge on exactly one side, whichever side that is', () => {
		const ours = challenge('Ours', { builtIn: 'spike' });
		const theirs = challenge('Theirs', {});
		// Started from an entry the folder no longer holds, so the catalogue has no words for it
		const retired = challenge('Retired', { builtIn: 'a-challenge-we-dropped' });

		const { builtIn, imported } = challengeCatalogue();
		expect(builtIn.map((c) => c.entry.id)).toEqual(['spike']);
		expect(builtIn[0].started?.id).toBe(ours.id);
		expect(imported.map((p) => p.id)).toEqual([theirs.id, retired.id]);
	});

	it('counts a run against the goals the folder says it has, not the record', () => {
		const started = challengeCatalogue().builtIn[0].started;
		expect(started).toBeDefined();
		expect(challengeCatalogue().builtIn[0]).toMatchObject({ goals: 2, best: 0, complete: false });

		started!.bestRun = ['one', 'two'];
		expect(challengeCatalogue().builtIn[0]).toMatchObject({ best: 2, complete: true });
	});

	it('counts a best run only against the goals this version still has', () => {
		const started = challengeCatalogue().builtIn[0].started;
		started!.bestRun = ['one', 'two', 'a-goal-since-dropped'];
		expect(challengeCatalogue().builtIn[0]).toMatchObject({ goals: 2, best: 2, complete: true });
	});

	it('takes on a version that has dropped a node the record started with', async () => {
		const started = challengeCatalogue().builtIn[0].started;
		const startingCanvas = {
			format: 'gg:project/1',
			nodes: [{ id: 'q', type: 'sqsQueue', position: { x: 0, y: 0 }, config: {} }],
			edges: [],
			nodeFiles: {}
		};
		started!.challenge = { ...(shipped as object), startingCanvas } as never;

		loadCatalogue();
		await vi.waitFor(() => expect(started!.challenge).toEqual(shipped));
	});

	it('takes on a version that plays differently, and the best run goes with it', async () => {
		const started = challengeCatalogue().builtIn[0].started;
		started!.bestRun = ['one', 'two'];
		started!.challenge = {
			...(shipped as object),
			title: 'What it used to be called',
			length: 99
		} as never;

		loadCatalogue();
		await vi.waitFor(() => expect(started!.challenge).toEqual(shipped));
		expect(started!.name).toBe('Keep up');
		expect(started!.bestRun).toBeUndefined();
	});

	it('keeps the goals a version still judges alike, where the run plays the same', async () => {
		const started = challengeCatalogue().builtIn[0].started;
		started!.bestRun = ['one', 'two'];
		// Met under a rule this version no longer judges by, so the record cannot keep it
		started!.challenge = {
			...(shipped as object),
			goals: {
				one: { title: 'One', conditions: [] },
				two: { title: 'Two', conditions: ['harder'] }
			}
		} as never;

		loadCatalogue();
		await vi.waitFor(() => expect(started!.challenge).toEqual(shipped));
		expect(started!.bestRun).toEqual(['one']);
	});

	it('passes on what the folder could not read, so the page can name it', () => {
		expect(challengeCatalogue().unread).toEqual(folder.unread);
	});
});
