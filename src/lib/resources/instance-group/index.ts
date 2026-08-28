import { z } from 'zod';
import { Position, type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import ServerIcon from '@lucide/svelte/icons/server';
import * as resourceFiles from 'virtual:resource-files';
import InstanceGroupConfig from './InstanceGroupConfig.svelte';
import type { NodeHandleConfig, ResourceDefinition } from '../types';
import { npmInstall, processHandle } from '../shared';
import { nodeDirectory } from '../../container';

const configSchema = z.object({
	name: z.string().min(1).default('Instance Group'),
	instanceCount: z.number().int().positive().default(3),
	command: z.string().min(1).default('npm run start')
});

type Config = z.infer<typeof configSchema>;

export const instanceGroup = {
	name: 'Instance Group',
	icon: ServerIcon,
	files: resourceFiles.instanceGroup,
	hasEditableFiles: true,
	handles: [{ type: 'target', position: Position.Left }] satisfies NodeHandleConfig[],
	configComponent: InstanceGroupConfig,
	configSchema,
	instanceCount: (node: Node) => (node.data as Config).instanceCount,
	launchConfig: (node: Node) => ({ command: (node.data as Config).command }),
	prepare: npmInstall,
	start: async (node: Node, container: Vivari, port: number) => {
		// Split command by whitespace
		const { command } = node.data as Config;
		const commandParts = command.match(/\S+/g);
		if (!commandParts) {
			throw new Error('Command is empty');
		}
		const process = await container.spawn(commandParts[0], commandParts.slice(1), {
			cwd: nodeDirectory(node.id),
			env: { PORT: String(port) }
		});
		return processHandle(process);
	}
} satisfies ResourceDefinition;
