import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import ServerIcon from '@lucide/svelte/icons/server';
import * as resourceFiles from 'virtual:resource-files';
import InstanceGroupConfig from './InstanceGroupConfig.svelte';
import type { ResourceDefinition, ConnectedNode } from '../types';
import { npmInstall, processHandle } from '../shared';
import { nodeDirectory } from '$lib/container';
import { nodeConfig } from '$lib/graph-state.svelte';
import { consumerEnv } from '../env';

const configSchema = z.object({
	name: z.string().min(1).default('Instance Group'),
	instanceCount: z.number().int().positive().default(3),
	command: z.string().min(1).default('npm run start')
});

export type Config = z.infer<typeof configSchema>;

function launchConfig(node: Node, upstreams: readonly ConnectedNode[]) {
	return {
		command: nodeConfig<Config>(node).command,
		env: consumerEnv(node, upstreams)
	};
}

type LaunchConfig = ReturnType<typeof launchConfig>;

export const instanceGroup = {
	name: 'Instance Group',
	icon: ServerIcon,
	files: resourceFiles.instanceGroup,
	hasEditableFiles: true,
	hasPreview: true,
	ownsStoredData: false,
	provides: ['http'],
	consumes: ['sql', 'aws'],
	configComponent: InstanceGroupConfig,
	configSchema,
	// The names the examples report. A user's own metric falls back to the default
	metricDefaults: { requests: 'Sum', 'response ms': 'Average' },
	instanceCount: (node: Node) => nodeConfig<Config>(node).instanceCount,
	runsProcesses: true,
	launchConfig,
	prepare: npmInstall,
	start: async (
		node: Node,
		container: Vivari,
		port: number,
		_upstreams: readonly ConnectedNode[],
		config: unknown
	) => {
		const { command, env } = config as LaunchConfig;
		// Split command by whitespace
		const commandParts = command.match(/\S+/g);
		if (!commandParts) {
			throw new Error('Command is empty');
		}
		const process = await container.spawn(commandParts[0], commandParts.slice(1), {
			cwd: nodeDirectory(node.id),
			env: { PORT: String(port), ...env }
		});
		return processHandle(process);
	}
} satisfies ResourceDefinition;
