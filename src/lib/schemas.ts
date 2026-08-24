import { z } from 'zod';
import { type FileSystemTree } from '@webcontainer/api';

export const schemas = {
	instanceGroup: z.object({
		name: z.string().min(1).default('Instance Group'),
		instanceCount: z.number().int().positive().default(1),
		runtime: z.enum(['node.js']).default('node.js'),
		command: z.string().default('npm run start')
	}),
	function: z.object({
		name: z.string().min(1).default('Function'),
		runtime: z.enum(['node.js']).default('node.js')
	}),
	loadBalancer: z.object({
		name: z.string().min(1).default('Load Balancer')
	})
};

export const defaultNodeData = {
	function: schemas.function.parse({}),
	instanceGroup: schemas.instanceGroup.parse({}),
	loadBalancer: schemas.loadBalancer.parse({})
};

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
