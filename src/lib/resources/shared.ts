import type { Node } from '@xyflow/svelte';
import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import type { InstanceHandle } from './types';

export async function npmInstall(node: Node, webContainer: WebContainer) {
	const installProcess = await webContainer.spawn('npm', ['install'], { cwd: node.id });
	if ((await installProcess.exit) !== 0) {
		throw new Error('Unable to run npm install');
	}
}

// Wraps the common case of an instance that is exactly one process. The exit code is
// dropped because the orchestrator only cares that the process exited, not how
export function processHandle(process: WebContainerProcess): InstanceHandle {
	return {
		exited: process.exit.then(() => undefined),
		stop: async () => {
			process.kill();
			await process.exit;
		}
	};
}
