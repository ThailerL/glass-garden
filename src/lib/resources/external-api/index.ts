import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import ExternalApiIcon from './ExternalApiIcon.svelte';
import ExternalApiConfig from './ExternalApiConfig.svelte';
import * as resourceFiles from 'virtual:resource-files';
import { callerPath } from '../../../../resources/external-api/caller.js';
import type { ConnectedNode, ResourceDefinition } from '../types';
import { processHandle } from '../shared';
import { nodeDirectory } from '$lib/container';
import { nodeConfig } from '$lib/graph-state.svelte';

const configSchema = z.object({
	name: z.string().min(1).default('External API'),
	// The author's module, in config since a non-editable directory is re-laid each start
	code: z.string().default('export function handle() {\n  return Response.json({ ok: true });\n}\n')
});

export type Config = z.infer<typeof configSchema>;

function launchConfig(node: Node) {
	return { code: nodeConfig<Config>(node).code };
}

type LaunchConfig = ReturnType<typeof launchConfig>;

export const externalApi = {
	name: 'External API',
	icon: ExternalApiIcon,
	files: resourceFiles.externalApi,
	hasEditableFiles: false,
	hasPreview: false,
	provides: ['api'],
	consumes: [],
	authorOnly: true,
	configComponent: ExternalApiConfig,
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
		soleName: 'EXTERNAL_API_URL'
	}),
	launchConfig,
	start: async (
		node: Node,
		container: Vivari,
		port: number,
		_targets: readonly ConnectedNode[],
		config: unknown
	) => {
		const { code } = config as LaunchConfig;
		const directory = nodeDirectory(node.id);
		await container.fs.writeFile(`${directory}/api.mjs`, code);
		const process = await container.spawn('node', ['server.js'], {
			cwd: directory,
			env: { PORT: String(port) }
		});
		return processHandle(process);
	},
	// Its state is whatever the author's module holds in memory
	clear: 'restart',
	// A sandbox's reset, rather than wiping a service the reader owns
	clearWords: { action: 'Reset test data', title: 'Reset test data?', done: 'Reset' }
} satisfies ResourceDefinition;
