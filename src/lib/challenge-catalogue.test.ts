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
const folder: ChallengeFolder = {
	challenges: [
		{
			id: 'spike',
			stack: 'One node',
			document: { title: 'Keep up', goals: { one: {}, two: {} } } as never
		}
	],
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
		challenge: { title: name, goals: { one: {}, two: {} } } as never,
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

	it('passes on what the folder could not read, so the page can name it', () => {
		expect(challengeCatalogue().unread).toEqual(folder.unread);
	});
});
