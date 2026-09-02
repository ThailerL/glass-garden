import type { Node } from '@xyflow/svelte';
import type { Vivari, VivariProcess } from '@vivari/core';
import type { Capture, InstanceHandle } from './types';
import { nodeDirectory } from '../container';
import { nodeName } from '../graph-state.svelte';

// Apostrophes and accents are folded away rather than becoming separators, so
// "Bob's Orders DB" reads as one word per word
export function slugify(
	text: string,
	// Narrowed because the separator lands inside a RegExp character class
	options: { separator: '-' | '_'; case: 'upper' | 'lower'; maxLength?: number }
) {
	const folded = text
		.normalize('NFD')
		.replace(/['\u2019]/g, '')
		.replace(/\p{Diacritic}/gu, '');
	return (options.case === 'upper' ? folded.toUpperCase() : folded.toLowerCase())
		.replace(/[^a-z0-9]+/gi, options.separator)
		.replace(new RegExp(`^[${options.separator}]+`), '')
		.slice(0, options.maxLength)
		.replace(new RegExp(`[${options.separator}]+$`), '');
}

// How a node's name becomes the prefix of the environment variables naming it, so a
// consumer wired to several resources gets meaningful names. One convention across every
// kind of variable - <SLUG>_URL, <SLUG>_BUCKET - and every kind of consumer
export function envSlug(node: Node) {
	return slugify(nodeName(node), { separator: '_', case: 'upper' }) || 'RESOURCE';
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
