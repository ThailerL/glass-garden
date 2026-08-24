import { z } from 'zod';
import { type FileSystemTree } from '@webcontainer/api';
import ServerIcon from '@lucide/svelte/icons/server';
import SquareFunctionIcon from '@lucide/svelte/icons/square-function';
import NetworkIcon from '@lucide/svelte/icons/network';
import * as NodeComponents from './components/nodes';
import * as SettingsComponents from './components/node-settings';

export const resourceDefinitions = {
	instanceGroup: {
		name: 'Instance Group',
		icon: ServerIcon,
		hasEditableFiles: true,
		nodeComponent: NodeComponents.InstanceGroupNode,
		settingsComponent: SettingsComponents.InstanceGroupSettings,
		settingsSchema: z.object({
			name: z.string().min(1).default('Instance Group'),
			instanceCount: z.number().int().positive().default(1),
			runtime: z.enum(['node.js']).default('node.js'),
			command: z.string().default('npm run start')
		})
	},
	function: {
		name: 'Function',
		icon: SquareFunctionIcon,
		hasEditableFiles: true,
		nodeComponent: NodeComponents.FunctionNode,
		settingsComponent: SettingsComponents.FunctionSettings,
		settingsSchema: z.object({
			name: z.string().min(1).default('Function'),
			runtime: z.enum(['node.js']).default('node.js')
		})
	},
	loadBalancer: {
		name: 'Load Balancer',
		icon: NetworkIcon,
		hasEditableFiles: false,
		nodeComponent: NodeComponents.LoadBalancerNode,
		settingsComponent: SettingsComponents.LoadBalancerSettings,
		settingsSchema: z.object({
			name: z.string().min(1).default('Load Balancer')
		})
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
