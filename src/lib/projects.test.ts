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

import { createProject, ensureProject, listChallenges, listProjects } from '$lib/projects.svelte';

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
