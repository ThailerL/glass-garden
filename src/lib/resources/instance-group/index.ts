import { z } from 'zod';
import { Position, type Node } from '@xyflow/svelte';
import { WebContainer } from '@webcontainer/api';
import ServerIcon from '@lucide/svelte/icons/server';
import * as snapshots from 'virtual:webcontainer-snapshots';
import InstanceGroupConfig from './InstanceGroupConfig.svelte';
import type { NodeHandleConfig, ResourceDefinition } from '../types';
import { npmInstall, processHandle } from '../shared';

const configSchema = z.object({
	name: z.string().min(1).default('Instance Group'),
	instanceCount: z.number().int().positive().default(3),
	command: z.string().min(1).default('npm run start')
});

type Config = z.infer<typeof configSchema>;

export const instanceGroup = {
	name: 'Instance Group',
	icon: ServerIcon,
	snapshot: snapshots.instanceGroup,
	hasEditableFiles: true,
	handles: [{ type: 'target', position: Position.Left }] satisfies NodeHandleConfig[],
	configComponent: InstanceGroupConfig,
	configSchema,
	instanceCount: (node: Node) => (node.data as Config).instanceCount,
	launchConfig: (node: Node) => ({ command: (node.data as Config).command }),
	prepare: npmInstall,
	start: async (node: Node, webContainer: WebContainer, port: number) => {
		// Split command by whitespace
		const { command } = node.data as Config;
		const commandParts = command.match(/\S+/g);
		if (!commandParts) {
			throw new Error('Command is empty');
		}
		const process = await webContainer.spawn(commandParts[0], commandParts.slice(1), {
			cwd: node.id,
			env: { PORT: port }
		});
		return processHandle(process);
	}
} satisfies ResourceDefinition;
