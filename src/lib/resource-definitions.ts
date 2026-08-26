import { z } from 'zod';
import { WebContainer, type FileSystemTree, type WebContainerProcess } from '@webcontainer/api';
import type { Node } from '@xyflow/svelte';
import ServerIcon from '@lucide/svelte/icons/server';
import NetworkIcon from '@lucide/svelte/icons/network';
import * as NodeComponents from './components/nodes';
import * as ConfigComponents from './components/node-configs';

const instanceGroupConfigSchema = z.object({
	name: z.string().min(1).default('Instance Group'),
	instanceCount: z.number().int().positive().default(1),
	command: z.string().min(1).default('npm run start')
});

const loadBalancerConfigSchema = z.object({
	name: z.string().min(1).default('Load Balancer')
});

export const resourceDefinitions = {
	instanceGroup: {
		name: 'Instance Group',
		icon: ServerIcon,
		hasEditableFiles: true,
		nodeComponent: NodeComponents.InstanceGroupNode,
		configComponent: ConfigComponents.InstanceGroupConfig,
		configSchema: instanceGroupConfigSchema,
		instanceCount: (node: Node) =>
			(node.data as z.infer<typeof instanceGroupConfigSchema>).instanceCount,
		// Runs once per group rather than once per instance, so instances don't race each other
		prepare: async (node: Node, webContainer: WebContainer) => {
			const installProcess = await webContainer.spawn('npm', ['install'], { cwd: node.id });
			if ((await installProcess.exit) !== 0) {
				throw new Error('Unable to run npm install');
			}
		},
		start: async (
			node: Node,
			webContainer: WebContainer,
			port: number
		): Promise<WebContainerProcess> => {
			// Split command by whitespace
			const { command } = node.data as z.infer<typeof instanceGroupConfigSchema>;
			const commandParts = command.match(/\S+/g);
			if (!commandParts) {
				throw new Error('Command is empty');
			}
			const process = await webContainer.spawn(commandParts[0], commandParts.slice(1), {
				cwd: node.id,
				env: { PORT: port }
			});

			return process;
		},
		stop: async (process: WebContainerProcess) => {
			process.kill();
			await process.exit;
		}
	},
	loadBalancer: {
		name: 'Load Balancer',
		icon: NetworkIcon,
		hasEditableFiles: false,
		nodeComponent: NodeComponents.LoadBalancerNode,
		configComponent: ConfigComponents.LoadBalancerConfig,
		configSchema: loadBalancerConfigSchema,
		instanceCount: () => 1,
		prepare: async () => {},
		start: async (): Promise<WebContainerProcess> => {
			throw new Error('Load balancer is not implemented yet');
		},
		stop: async (process: WebContainerProcess) => {
			process.kill();
			await process.exit;
		}
	}
};

export type ResourceType = keyof typeof resourceDefinitions;
export type ResourceDefinition = (typeof resourceDefinitions)[ResourceType];

export function getResourceDefinition(node: Node): ResourceDefinition {
	const definition = resourceDefinitions[node.type as ResourceType];
	if (!definition) {
		throw new Error(`Unknown resource type: ${node.type}`);
	}
	return definition;
}

export const defaultFiles: FileSystemTree = {
	src: {
		directory: {
			'server.js': {
				file: {
					contents: `import express from 'express';
const app = express();
const port = process.env.PORT || 3000;
// Picked once at startup so every instance of this group serves a different number
const instanceId = Math.floor(Math.random() * 10000);

app.get('/', (req, res) => {
  res.send(\`Hello World from instance \${instanceId}\`);
});

app.listen(port, () => {
  console.log(\`Server running on http://localhost:\${port}\`);
});`
				}
			}
		}
	},
	'package.json': {
		file: {
			contents: `{
  "name": "hello-world",
  "type": "module",
  "dependencies": {
    "express": "latest"
  },
  "scripts": {
    "start": "node src/server.js"
  }
}`
		}
	}
};
