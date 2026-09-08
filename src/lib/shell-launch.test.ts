import { describe, it, expect, vi } from 'vitest';
import { shellLaunchOptions } from '$lib/shell-launch';
import type { Orchestrator } from '$lib/orchestrator.svelte';

const ensureAdminDirectory = vi.hoisted(() => vi.fn());
vi.mock('$lib/container', () => ({
	nodeDirectory: (nodeId: string) => `/projects/p1/nodes/${nodeId}`,
	adminDirectory: () => '/projects/p1/admin',
	ensureAdminDirectory
}));

function fakeOrchestrator(ports = [4001]) {
	const released: number[] = [];
	const mounted: string[] = [];
	let next = 0;
	const orchestrator = {
		holdPort: () => ports[next++],
		releasePort: (port: number) => void released.push(port),
		mountFiles: async (nodeId: string) => void mounted.push(nodeId),
		envFor: () => ({ AWS_ACCESS_KEY_ID: 'ggn1', SIGNUPS_QUEUE_URL: 'http://queue' }),
		adminEnv: () => ({ AWS_ACCESS_KEY_ID: 'ggadmin' })
	} as unknown as Orchestrator;
	return { orchestrator, released, mounted };
}

describe('shellLaunchOptions', () => {
	it('gives a node shell its directory and its own environment', () => {
		const { orchestrator } = fakeOrchestrator();

		const launch = shellLaunchOptions({ kind: 'node', nodeId: 'n1' }, orchestrator);

		expect(launch.cwd).toBe('/projects/p1/nodes/n1');
		expect(launch.env).toEqual({
			PORT: '4001',
			TERM: 'xterm-256color',
			AWS_ACCESS_KEY_ID: 'ggn1',
			SIGNUPS_QUEUE_URL: 'http://queue'
		});
	});

	it("gives an admin shell its own directory and the admin credentials, not a node's", () => {
		const { orchestrator } = fakeOrchestrator();

		const launch = shellLaunchOptions({ kind: 'admin' }, orchestrator);

		expect(launch.cwd).toBe('/projects/p1/admin');
		expect(launch.env).toEqual({
			PORT: '4001',
			TERM: 'xterm-256color',
			AWS_ACCESS_KEY_ID: 'ggadmin'
		});
	});

	it('holds a distinct port per shell and releases the right one', () => {
		const { orchestrator, released } = fakeOrchestrator([4001, 4002]);

		const first = shellLaunchOptions({ kind: 'admin' }, orchestrator);
		const second = shellLaunchOptions({ kind: 'admin' }, orchestrator);
		second.release();

		expect([first.port, second.port]).toEqual([4001, 4002]);
		expect(released).toEqual([4002]);
	});

	it('mounts a node shell its files, since it may be the first thing to want them', async () => {
		const { orchestrator, mounted } = fakeOrchestrator();

		await shellLaunchOptions({ kind: 'node', nodeId: 'n1' }, orchestrator).prepare();

		expect(mounted).toEqual(['n1']);
	});

	it('creates the admin directory, which nothing else lays down', async () => {
		const { orchestrator } = fakeOrchestrator();

		await shellLaunchOptions({ kind: 'admin' }, orchestrator).prepare();

		expect(ensureAdminDirectory).toHaveBeenCalled();
	});

	it('names the port it held, in the banner and to the shell', () => {
		const { orchestrator } = fakeOrchestrator();

		const launch = shellLaunchOptions({ kind: 'admin' }, orchestrator);

		expect(launch.port).toBe(4001);
		expect(launch.banner).toContain('PORT=4001');
	});
});
