import type { Node } from '@xyflow/svelte';
import type { Vivari, VivariProcess } from '@vivari/core';
import type { Capture, InstanceHandle } from './types';
import { nodeDirectory } from '../container';
import { nodeName } from '../graph-state.svelte';

// How a node's name becomes the prefix of the environment variables naming it, so a
// consumer wired to several resources gets meaningful names. One convention across every
// kind of variable - <SLUG>_URL, <SLUG>_BUCKET - and every kind of consumer.
// "Bob's Orders DB" -> BOBS_ORDERS_DB. Apostrophes and accents are folded away rather
// than becoming separators
export function envSlug(node: Node) {
	const cleaned = nodeName(node)
		.normalize('NFD')
		.replace(/['\u2019]/g, '')
		.replace(/\p{Diacritic}/gu, '')
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return cleaned || 'RESOURCE';
}

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

// Wraps the common case of an instance that is exactly one process
export function processHandle(process: VivariProcess): InstanceHandle {
	return {
		exited: process.exit,
		stop: async () => {
			process.kill();
			await process.exit;
		},
		output: process.output
	};
}
