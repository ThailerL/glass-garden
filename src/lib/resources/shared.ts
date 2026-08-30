import type { Node } from '@xyflow/svelte';
import type { Vivari, VivariProcess } from '@vivari/core';
import type { Capture, InstanceHandle } from './types';
import { nodeDirectory } from '../container';

export async function npmInstall(node: Node, container: Vivari, capture?: Capture) {
	const installProcess = await container.spawn('npm', ['install'], {
		cwd: nodeDirectory(node.id)
	});
	capture?.(installProcess.output);
	const code = await installProcess.exit;
	// The code separates npm running and rejecting the install from npm never running
	if (code !== 0) {
		throw new Error(`npm install exited ${code}`);
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
		},
		output: process.output
	};
}
