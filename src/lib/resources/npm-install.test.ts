import { describe, it, expect, beforeEach } from 'vitest';
import type { Node } from '@xyflow/svelte';
import type { Vivari } from '@vivari/core';
import { npmInstall } from './shared';
import { setActiveProject } from '$lib/container';

// Only the two calls npmInstall makes: reading the manifest, and spawning npm if it must
function fakeContainer(manifest: string | undefined, exitCode = 0) {
	const spawns: { command: string; args: string[]; cwd?: string }[] = [];
	const container = {
		fs: {
			readFile: async () => {
				if (manifest === undefined) throw new Error('ENOENT');
				return manifest;
			}
		},
		spawn: async (command: string, args: string[], options?: { cwd?: string }) => {
			spawns.push({ command, args, cwd: options?.cwd });
			return { output: undefined, exit: Promise.resolve(exitCode) };
		}
	} as unknown as Vivari;
	return { container, spawns };
}

const node = { id: 'n1' } as Node;

describe('npmInstall', () => {
	beforeEach(() => setActiveProject('p1'));

	it('installs when the manifest declares dependencies', async () => {
		const { container, spawns } = fakeContainer('{"dependencies":{"express":"^5.1.0"}}');
		await npmInstall(node, container);
		expect(spawns).toEqual([{ command: 'npm', args: ['install'], cwd: '/projects/p1/nodes/n1' }]);
	});

	it('installs for devDependencies and optionalDependencies too', async () => {
		for (const group of ['devDependencies', 'optionalDependencies']) {
			const { container, spawns } = fakeContainer(`{"${group}":{"vitest":"^4"}}`);
			await npmInstall(node, container);
			expect(spawns).toHaveLength(1);
		}
	});

	it('skips an app with nothing to install, which costs seconds of startup', async () => {
		const { container, spawns } = fakeContainer('{"name":"web-app","type":"module"}');
		await npmInstall(node, container);
		expect(spawns).toEqual([]);
	});

	it('skips an empty dependency block rather than reading it as work', async () => {
		const { container, spawns } = fakeContainer('{"dependencies":{}}');
		await npmInstall(node, container);
		expect(spawns).toEqual([]);
	});

	it('skips a node with no manifest, where npm would fail outright', async () => {
		const { container, spawns } = fakeContainer(undefined);
		await npmInstall(node, container);
		expect(spawns).toEqual([]);
	});

	it('lets npm report a manifest it cannot parse', async () => {
		const { container, spawns } = fakeContainer('{ not json');
		await npmInstall(node, container);
		expect(spawns).toHaveLength(1);
	});

	it('still fails the prepare when an install it did run rejects', async () => {
		const { container } = fakeContainer('{"dependencies":{"express":"^5"}}', 1);
		await expect(npmInstall(node, container)).rejects.toThrow('npm install exited 1');
	});
});
