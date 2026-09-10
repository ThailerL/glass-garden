import { describe, it, expect, vi, beforeEach } from 'vitest';
import { leaveForMainApp, mainAppUrl, openEmbeddedProject } from '$lib/embed';
import { encodeShareLink } from '$lib/share-link';

const { publicEnv, projects, location } = vi.hoisted(() => {
	// embed.ts reads the frame it is in at import, so these run it as a page of its own
	const page = {};
	const location = {
		origin: 'https://intro.embed.glass.garden',
		hostname: 'intro.embed.glass.garden',
		pathname: '/',
		hash: '',
		replace: vi.fn()
	};
	Object.assign(globalThis, {
		window: { self: page, top: page },
		location,
		history: { replaceState: () => {} }
	});
	return {
		location,
		publicEnv: { PUBLIC_ORIGIN: undefined as string | undefined },
		projects: {
			getProject: vi.fn(),
			importProject: vi.fn(),
			deleteProject: vi.fn(),
			setLastProjectId: vi.fn()
		}
	};
});

vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$lib/projects.svelte', () => projects);
vi.mock('$lib/project-document', () => ({ parseProjectDocument: JSON.parse }));

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

const hashOf = async (name: string) =>
	new URL(await encodeShareLink(JSON.stringify({ name }), 'https://x')).hash;

let nextId = 0;

beforeEach(() => {
	globalThis.localStorage = makeLocalStorage();
	publicEnv.PUBLIC_ORIGIN = undefined;
	Object.assign(location, {
		origin: 'https://intro.embed.glass.garden',
		hostname: 'intro.embed.glass.garden',
		hash: ''
	});
	vi.clearAllMocks();
	projects.importProject.mockImplementation(async (doc: { name: string }) => ({
		id: `${doc.name}-${++nextId}`
	}));
	projects.getProject.mockReturnValue({});
});

describe('mainAppUrl', () => {
	it('prefers PUBLIC_ORIGIN and keeps the link', () => {
		publicEnv.PUBLIC_ORIGIN = 'https://glass.garden';
		expect(mainAppUrl('#project=abc')).toBe('https://glass.garden/#project=abc');
	});

	it('falls back to the origin serving the embed', () => {
		expect(mainAppUrl('')).toBe('https://intro.embed.glass.garden/');
	});
});

describe('leaveForMainApp', () => {
	it('sends a reader on an embed address to the deployment, link and all', () => {
		publicEnv.PUBLIC_ORIGIN = 'https://glass.garden';
		location.hash = '#project=abc';
		expect(leaveForMainApp()).toBe(true);
		expect(location.replace).toHaveBeenCalledWith('https://glass.garden/#project=abc');
	});

	it('stays put where the deployment has no address of its own', () => {
		expect(leaveForMainApp()).toBe(false);
		expect(location.replace).not.toHaveBeenCalled();
	});

	it('stays put on the address the deployment answers on', () => {
		publicEnv.PUBLIC_ORIGIN = 'https://intro.embed.glass.garden/';
		expect(leaveForMainApp()).toBe(false);
	});

	it('stays put on the container reached directly', () => {
		publicEnv.PUBLIC_ORIGIN = 'https://garden.example.com';
		Object.assign(location, { origin: 'http://localhost:3000', hostname: 'localhost' });
		expect(leaveForMainApp()).toBe(false);
	});
});

describe('openEmbeddedProject', () => {
	it('imports the project on a first visit', async () => {
		const id = await openEmbeddedProject(await hashOf('lesson'));
		expect(id).toBe('lesson-1');
		expect(projects.importProject).toHaveBeenCalledWith({ name: 'lesson' });
		expect(projects.setLastProjectId).toHaveBeenCalledWith(id);
		expect(projects.deleteProject).not.toHaveBeenCalled();
	});

	it('resumes the same project while the link is unchanged', async () => {
		const hash = await hashOf('lesson');
		const first = await openEmbeddedProject(hash);
		expect(await openEmbeddedProject(hash)).toBe(first);
		expect(projects.importProject).toHaveBeenCalledTimes(1);
	});

	it('imports again when the resumed project has been deleted', async () => {
		const hash = await hashOf('lesson');
		await openEmbeddedProject(hash);
		projects.getProject.mockReturnValue(undefined);
		await openEmbeddedProject(hash);
		expect(projects.importProject).toHaveBeenCalledTimes(2);
	});

	it('replaces the project when the link changes', async () => {
		const first = await openEmbeddedProject(await hashOf('lesson'));
		const second = await openEmbeddedProject(await hashOf('lesson 2'));
		expect(second).not.toBe(first);
		expect(projects.deleteProject).toHaveBeenCalledWith(first);
	});

	it('keeps the previous project when the import fails', async () => {
		const hash = await hashOf('lesson');
		const first = await openEmbeddedProject(hash);
		projects.importProject.mockRejectedValueOnce(new Error('no room'));
		await expect(openEmbeddedProject(await hashOf('lesson 2'))).rejects.toThrow('no room');
		expect(projects.deleteProject).not.toHaveBeenCalled();
		expect(await openEmbeddedProject(hash)).toBe(first);
	});
});
