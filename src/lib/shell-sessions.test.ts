import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	ShellSessions,
	type ShellLaunchOptions,
	type ShellOwner
} from '$lib/shell-sessions.svelte';

const terminals = vi.hoisted(
	() =>
		[] as {
			written: string[];
			disposed: boolean;
			onDataHandler?: (data: string) => void;
		}[]
);

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		written: string[] = [];
		disposed = false;
		onDataHandler: ((data: string) => void) | undefined;
		element: HTMLElement | undefined;
		constructor() {
			terminals.push(this as never);
		}
		loadAddon() {}
		write(chunk: string) {
			if (this.disposed) throw new Error('write after dispose');
			this.written.push(chunk);
		}
		onData(handler: (data: string) => void) {
			this.onDataHandler = handler;
		}
		focus() {}
		open() {}
		dispose() {
			this.disposed = true;
		}
	}
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));

const spawn = vi.hoisted(() => vi.fn());
// Listeners the fake container handed out, so a test can fire server-ready itself
const serverReady = vi.hoisted(() => [] as ((port: number, url: string) => void)[]);
vi.mock('$lib/container', () => ({
	getContainer: async () => ({
		spawn,
		on: (_event: string, listener: (port: number, url: string) => void) => {
			serverReady.push(listener);
			return () => serverReady.splice(serverReady.indexOf(listener), 1);
		}
	}),
	onContainerShutdown: vi.fn()
}));

function fakeProcess() {
	let push!: (chunk: string) => void;
	let close!: () => void;
	let end!: (code: number) => void;
	const written: string[] = [];
	const killed = { count: 0 };

	const process = {
		output: new ReadableStream<string>({
			start(controller) {
				push = (chunk) => controller.enqueue(chunk);
				close = () => controller.close();
			}
		}),
		input: new WritableStream<string>({ write: (chunk) => void written.push(chunk) }),
		exit: new Promise<number>((resolve) => (end = resolve)),
		kill: () => {
			killed.count += 1;
			close();
			end(0);
		}
	};
	return { process, push, close, end, written, killed };
}

const NODE: ShellOwner = { kind: 'node', nodeId: 'n1' };
const ADMIN: ShellOwner = { kind: 'admin' };

function launch(overrides: Partial<ShellLaunchOptions> = {}): ShellLaunchOptions {
	return {
		cwd: '/projects/p1/nodes/n1',
		env: { PORT: '4001' },
		port: 4001,
		prepare: vi.fn(async () => {}),
		release: vi.fn(),
		banner: 'PORT=4001',
		...overrides
	};
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ShellSessions', () => {
	let sessions: ShellSessions;

	beforeEach(() => {
		terminals.length = 0;
		serverReady.length = 0;
		spawn.mockReset();
		sessions = new ShellSessions();
	});

	it('adds a shell synchronously and makes it active', () => {
		spawn.mockImplementation(async () => fakeProcess().process);

		const shell = sessions.open(NODE, launch());

		expect(sessions.shells).toHaveLength(1);
		expect(sessions.activeId).toBe(shell.id);
	});

	it('prepares the working directory before spawning in it', async () => {
		spawn.mockImplementation(async () => fakeProcess().process);
		const prepare = vi.fn(async () => expect(spawn).not.toHaveBeenCalled());

		sessions.open(ADMIN, launch({ cwd: '/projects/p1/admin', env: { PORT: '4002' }, prepare }));
		await flush();

		expect(prepare).toHaveBeenCalled();
		expect(spawn).toHaveBeenCalledWith('sh', [], {
			cwd: '/projects/p1/admin',
			env: { PORT: '4002' }
		});
	});

	it('reports a failed prepare in that shell rather than spawning', async () => {
		const prepare = vi.fn(async () => {
			throw new Error('no files');
		});

		sessions.open(NODE, launch({ prepare }));
		await flush();

		expect(spawn).not.toHaveBeenCalled();
		expect(terminals[0].written.join('')).toContain('no files');
	});

	it('writes the banner first and keeps writing output while nothing displays it', async () => {
		const fake = fakeProcess();
		spawn.mockImplementation(async () => fake.process);

		sessions.open(NODE, launch());
		await flush();
		fake.push('$ ');
		await flush();

		expect(terminals[0].written).toEqual(['PORT=4001\r\n', '$ ']);
		expect(terminals[0].disposed).toBe(false);
	});

	it('prints the address when a server starts on its own port, and ignores others', async () => {
		spawn.mockImplementation(async () => fakeProcess().process);

		sessions.open(NODE, launch({ port: 4001 }));
		await flush();
		for (const listener of serverReady) listener(4002, 'http://localhost/preview/4002/');
		for (const listener of serverReady) listener(4001, 'http://localhost/preview/4001/');

		const written = terminals[0].written.join('');
		expect(written).toContain('Open in the browser: http://localhost/preview/4001/');
		expect(written).not.toContain('4002');
	});

	it('stops listening for its port once closed', async () => {
		spawn.mockImplementation(async () => fakeProcess().process);

		const shell = sessions.open(NODE, launch());
		await flush();
		sessions.close(shell.id);

		expect(serverReady).toHaveLength(0);
	});

	it('sends typed data to the process', async () => {
		const fake = fakeProcess();
		spawn.mockImplementation(async () => fake.process);

		sessions.open(NODE, launch());
		await flush();
		terminals[0].onDataHandler?.('ls\n');
		await flush();

		expect(fake.written).toEqual(['ls\n']);
	});

	it('marks an exited shell and releases its port, keeping the tab', async () => {
		const fake = fakeProcess();
		spawn.mockImplementation(async () => fake.process);
		const release = vi.fn();

		const shell = sessions.open(NODE, launch({ release }));
		await flush();
		fake.close();
		fake.end(0);
		await flush();

		expect(shell.exited).toBe(true);
		expect(sessions.shells).toHaveLength(1);
		expect(release).toHaveBeenCalled();
	});

	it('kills, disposes and releases when a tab is closed', async () => {
		const fake = fakeProcess();
		spawn.mockImplementation(async () => fake.process);
		const release = vi.fn();

		const shell = sessions.open(NODE, launch({ release }));
		await flush();
		sessions.close(shell.id);
		await flush();

		expect(fake.killed.count).toBe(1);
		expect(terminals[0].disposed).toBe(true);
		expect(release).toHaveBeenCalled();
		expect(sessions.shells).toHaveLength(0);
		expect(sessions.activeId).toBeUndefined();
	});

	it('kills a process that arrives after its tab was closed', async () => {
		const fake = fakeProcess();
		let resolveSpawn!: () => void;
		spawn.mockImplementation(
			() => new Promise((resolve) => (resolveSpawn = () => resolve(fake.process)))
		);

		const shell = sessions.open(NODE, launch());
		// Let getContainer settle so spawn is called and left pending, then close on top of it
		await flush();
		sessions.close(shell.id);
		expect(sessions.shells).toHaveLength(0);

		resolveSpawn();
		await flush();

		expect(fake.killed.count).toBe(1);
	});

	it('reports a failed spawn in that shell and keeps it listed', async () => {
		spawn.mockImplementation(async () => {
			throw new Error('no shell');
		});
		const release = vi.fn();

		const shell = sessions.open(NODE, launch({ release }));
		await flush();

		expect(terminals[0].written.join('')).toContain('no shell');
		expect(sessions.shells).toContain(shell);
		expect(shell.exited).toBe(true);
		expect(release).toHaveBeenCalled();
	});

	it('moves active to a neighbour when the active tab closes', () => {
		spawn.mockImplementation(async () => fakeProcess().process);

		const first = sessions.open(NODE, launch());
		const second = sessions.open(NODE, launch());
		sessions.activeId = first.id;

		sessions.close(first.id);

		expect(sessions.activeId).toBe(second.id);
	});

	it('closes every shell for a node and leaves others alone', () => {
		spawn.mockImplementation(async () => fakeProcess().process);

		sessions.open(NODE, launch());
		sessions.open(NODE, launch());
		const admin = sessions.open(ADMIN, launch());

		sessions.closeForNode('n1');

		expect(sessions.shells).toEqual([admin]);
	});

	it('ensureFor opens once per owner, open always adds another', () => {
		spawn.mockImplementation(async () => fakeProcess().process);

		const first = sessions.ensureFor(NODE, launch);
		const again = sessions.ensureFor(NODE, launch);
		sessions.open(NODE, launch());

		expect(again).toBe(first);
		expect(sessions.shells).toHaveLength(2);
	});

	it('disposeAll kills everything', async () => {
		const fakes = [fakeProcess(), fakeProcess()];
		spawn.mockImplementation(async () => fakes[spawn.mock.calls.length - 1].process);

		sessions.open(NODE, launch());
		sessions.open(ADMIN, launch());
		await flush();
		sessions.disposeAll();
		await flush();

		expect(fakes.map((fake) => fake.killed.count)).toEqual([1, 1]);
		expect(sessions.shells).toHaveLength(0);
		expect(sessions.activeId).toBeUndefined();
	});
});
