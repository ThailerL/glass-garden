import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import GlobeIcon from '@lucide/svelte/icons/globe';
import ExternalSystemConfig from './ExternalSystemConfig.svelte';
import * as resourceFiles from 'virtual:resource-files';
import { callerPath } from '../../../../resources/external-system/caller.js';
import type { ConnectedNode, ResourceDefinition } from '../types';
import { providing } from '../index';
import { processHandle, runningPort, withHarness } from '../shared';
import { nodeDirectory } from '$lib/container';
import { nodeConfig, nodeName } from '$lib/graph-state.svelte';

const configSchema = z.object({
	name: z.string().min(1).default('External System'),
	// The author's module, in config since a non-editable directory is re-laid each start
	code: z.string().default('export function handle() {\n  return Response.json({ ok: true });\n}\n')
});

export type Config = z.infer<typeof configSchema>;

function launchConfig(node: Node) {
	return { code: nodeConfig<Config>(node).code };
}

type LaunchConfig = ReturnType<typeof launchConfig>;

export function endpointsOf(targets: readonly ConnectedNode[]) {
	return providing(targets, 'http').map((target) => ({
		name: nodeName(target.node),
		port: runningPort(target)
	}));
}

// Re-read by the running harness, so an edge change reaches it without a restart
async function writeEndpoints(node: Node, container: Vivari, targets: readonly ConnectedNode[]) {
	// An update can reach a service whose start has not mounted it yet
	await container.fs.mkdir(nodeDirectory(node.id), { recursive: true });
	await container.fs.writeFile(
		`${nodeDirectory(node.id)}/endpoints.json`,
		JSON.stringify(endpointsOf(targets))
	);
}

export const externalSystem = {
	name: 'External System',
	icon: GlobeIcon,
	files: withHarness(resourceFiles.externalSystem),
	hasEditableFiles: false,
	hasPreview: false,
	provides: ['api'],
	consumes: ['http'],
	authorOnly: true,
	configComponent: ExternalSystemConfig,
	readOnlyConfig: true,
	configSchema,
	metricDefaults: { errors: 'Average' },
	instanceCount: () => 1,
	runsProcesses: true,
	// Someone else's service: the reader can call it but never stop it
	alwaysOn: true,
	supplies: (_node: Node, port: number, consumer: Node) => ({
		suffix: 'URL',
		value: `http://localhost:${port}${callerPath(consumer.id)}`,
		soleName: 'EXTERNAL_SYSTEM_URL'
	}),
	launchConfig,
	start: async (
		node: Node,
		container: Vivari,
		port: number,
		targets: readonly ConnectedNode[],
		config: unknown
	) => {
		const { code } = config as LaunchConfig;
		const directory = nodeDirectory(node.id);
		// Before the spawn, so a send from the first moment already has somewhere to go
		await Promise.all([
			container.fs.writeFile(`${directory}/api.mjs`, code),
			writeEndpoints(node, container, targets)
		]);
		const process = await container.spawn('node', ['server.js'], {
			cwd: directory,
			env: { PORT: String(port) }
		});
		return processHandle(process);
	},
	update: writeEndpoints,
	// Its state is whatever the author's module holds in memory
	clear: 'restart',
	// A sandbox's reset, rather than wiping a service the reader owns
	clearWords: { action: 'Reset test data', title: 'Reset test data?', done: 'Reset' }
} satisfies ResourceDefinition;
