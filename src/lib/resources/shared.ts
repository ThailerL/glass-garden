import type { Node } from '@xyflow/svelte';
import type { Vivari, VivariProcess } from '@vivari/core';
import type { InstanceHandle } from './types';
import { nodeDirectory } from '../container';

export async function npmInstall(node: Node, container: Vivari) {
	const installProcess = await container.spawn('npm', ['install'], {
		cwd: nodeDirectory(node.id)
	});
	if ((await installProcess.exit) !== 0) {
		throw new Error('Unable to run npm install');
	}
}

// Wraps the common case of an instance that is exactly one process. The exit code is
// dropped because the orchestrator only cares that the process exited, not how
export function processHandle(process: VivariProcess): InstanceHandle {
	return {
		exited: process.exit.then(() => undefined),
		stop: async () => {
			process.kill();
			await process.exit;
		}
	};
}
