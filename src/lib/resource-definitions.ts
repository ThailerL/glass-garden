import { z } from 'zod';
import { WebContainer, type FileSystemTree, type WebContainerProcess } from '@webcontainer/api';
import type { Node } from '@xyflow/svelte';
import ServerIcon from '@lucide/svelte/icons/server';
import NetworkIcon from '@lucide/svelte/icons/network';
import * as NodeComponents from './components/nodes';
import * as ConfigComponents from './components/node-configs';

// IANA registered port range
export const MIN_PORT = 1024;
export const MAX_PORT = 49151;

const instanceGroupConfigSchema = z.object({
	name: z.string().min(1).default('Instance Group'),
	instanceCount: z.number().int().positive().default(1),
	command: z.string().min(1).default('npm run start'),
	port: z.number().int().min(MIN_PORT).max(MAX_PORT)
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
		start: async (node: Node, webContainer: WebContainer): Promise<WebContainerProcess> => {
			const installProcess = await webContainer.spawn('npm', ['install'], { cwd: node.id });
			if ((await installProcess.exit) !== 0) {
				throw new Error('Unable to run npm install');
			}

			// Split command by whitespace
			const { command } = node.data as z.infer<typeof instanceGroupConfigSchema>;
			const commandParts = command.match(/\S+/g);
			if (!commandParts) {
				throw new Error('Command is empty');
			}
			const process = await webContainer.spawn(commandParts[0], commandParts.slice(1), {
				cwd: node.id
			});

			return process;
		},
		stop: async (process: WebContainerProcess) => {
			process.kill();
		}
	},
	loadBalancer: {
		name: 'Load Balancer',
		icon: NetworkIcon,
		hasEditableFiles: false,
		nodeComponent: NodeComponents.LoadBalancerNode,
		configComponent: ConfigComponents.LoadBalancerConfig,
		configSchema: loadBalancerConfigSchema,
		start: async (): Promise<WebContainerProcess> => {
			throw new Error('Load balancer is not implemented yet');
		},
		stop: async (process: WebContainerProcess) => {
			process.kill();
		}
	}
};

export type ResourceType = keyof typeof resourceDefinitions;

export const defaultFiles: FileSystemTree = {
	src: {
		directory: {
			'server.js': {
				file: {
					contents: `import express from 'express';
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send('Hello World');
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
