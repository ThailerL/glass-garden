import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { VivariProcess } from '@vivari/core';
import { getContainer, onContainerShutdown } from './container';
import { messageOf } from './errors';

export type ShellOwner = { kind: 'node'; nodeId: string } | { kind: 'admin' };

export type ShellLaunchOptions = {
	cwd: string;
	env: Record<string, string>;
	port: number;
	// Puts the working directory on disk. A shell can be the first thing to ask for it
	prepare: () => Promise<void>;
	release: () => void;
	banner: string;
};

export class Shell {
	readonly id = crypto.randomUUID();
	readonly terminal: Terminal;
	readonly fitAddon = new FitAddon();
	readonly port: number;

	exited = $state(false);

	readonly #release: () => void;
	#process: VivariProcess | undefined;
	#unwatchServer = () => {};
	#disposed = false;

	constructor(
		readonly owner: ShellOwner,
		launchOptions: ShellLaunchOptions
	) {
		// Left unopened: xterm measures cell size from the DOM, so a hidden host would give
		// dimensions fit() cannot repair. Writes buffer until a view opens it
		this.terminal = new Terminal({ convertEol: true });
		this.terminal.loadAddon(this.fitAddon);
		this.terminal.write(`${launchOptions.banner}\r\n`);
		this.port = launchOptions.port;
		this.#release = launchOptions.release;

		void this.#run(launchOptions);
	}

	async #start({ cwd, env, prepare }: ShellLaunchOptions) {
		const container = await getContainer();

		const unwatch = container.on('server-ready', (port, url) => {
			if (port !== this.port || this.#disposed) return;
			this.terminal.write(`\r\n\x1b[2mOpen in the browser: ${url}\x1b[0m\r\n`);
		});
		if (this.#disposed) unwatch();
		else this.#unwatchServer = unwatch;

		await prepare();
		return container.spawn('sh', [], { cwd, env });
	}

	async #run(launchOptions: ShellLaunchOptions) {
		try {
			const process = await this.#start(launchOptions);
			// Closed while it was still spawning, so nothing but this holds the process
			if (this.#disposed) return process.kill();
			this.#process = process;

			const input = process.input.getWriter();
			this.terminal.onData((data) => void input.write(data).catch(() => {}));

			// Not pipeTo: kill() closes the stream and ends this, with no cancel() to reason about
			const reader = process.output.getReader();
			while (!this.#disposed) {
				const { value, done } = await reader.read();
				if (done) break;
				this.terminal.write(value);
			}
			await process.exit;
		} catch (error) {
			if (!this.#disposed) this.terminal.write(`\r\n\x1b[31m${messageOf(error)}\x1b[0m\r\n`);
		}
		if (this.#disposed) return;
		this.terminal.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
		this.exited = true;
		this.#release();
	}

	// The host became visible: the only moment it is safe to open or measure
	reveal(host: HTMLElement) {
		const element = this.terminal.element;
		if (!element) this.terminal.open(host);
		else if (element.parentElement !== host) host.appendChild(element);
		// Next frame, so the move has been laid out before it is measured
		requestAnimationFrame(() => {
			this.fit();
			this.terminal.focus();
		});
	}

	fit() {
		if (this.#disposed || !this.terminal.element?.offsetParent) return;
		this.fitAddon.fit();
	}

	dispose() {
		this.#disposed = true;
		this.#unwatchServer();
		// A spawn still in flight is killed by #run when it lands
		this.#process?.kill();
		this.terminal.dispose();
		this.#release();
	}
}

export class ShellSessions {
	readonly shells = $state<Shell[]>([]);
	activeId = $state<string | undefined>(undefined);

	open(owner: ShellOwner, launch: ShellLaunchOptions): Shell {
		const shell = new Shell(owner, launch);
		this.shells.push(shell);
		this.activeId = shell.id;
		return shell;
	}

	ensureFor(owner: ShellOwner, launch: () => ShellLaunchOptions): Shell {
		const key = ownerKey(owner);
		const existing = this.shells.find((shell) => ownerKey(shell.owner) === key);
		if (existing) return existing;
		return this.open(owner, launch());
	}

	close(id: string) {
		const index = this.shells.findIndex((shell) => shell.id === id);
		if (index === -1) return;
		const [shell] = this.shells.splice(index, 1);
		shell.dispose();
		if (this.activeId !== id) return;
		this.activeId = (this.shells[index] ?? this.shells[index - 1])?.id;
	}

	closeForNode(nodeId: string) {
		const key = ownerKey({ kind: 'node', nodeId });
		this.shells
			.filter((shell) => ownerKey(shell.owner) === key)
			.forEach((shell) => this.close(shell.id));
	}

	disposeAll() {
		for (const shell of this.shells.splice(0)) shell.dispose();
		this.activeId = undefined;
	}
}

const ownerKey = (owner: ShellOwner) => (owner.kind === 'node' ? `node:${owner.nodeId}` : 'admin');

export const shellSessions = new ShellSessions();

// At module scope, not in the constructor: container.ts never prunes its shutdown tasks
onContainerShutdown(async () => shellSessions.disposeAll());
