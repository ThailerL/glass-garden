import { z } from 'zod';
import { type FileSystemTree } from '@webcontainer/api';

export const schemas = {
	service: z.object({
		name: z.string().min(1).default('Service'),
		runtime: z.enum(['node.js']).default('node.js'),
		command: z.string().default('npm run start'),
		files: z.unknown().default({
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
		} satisfies FileSystemTree)
	}),
	function: z.object({
		name: z.string().min(1).default('Function'),
		runtime: z.enum(['node.js']).default('node.js')
	}),
	loadBalancer: z.object({
		name: z.string().min(1).default('Load Balancer'),
		targetGroups: z
			.array(
				z.object({
					id: z.string().readonly(),
					name: z.string().min(1).default('Target Group'),
					weight: z.number().int().nonnegative().default(1)
				})
			)
			.default([])
	})
};

export const defaultNodeData = {
	function: schemas.function.parse({}),
	service: schemas.service.parse({}),
	loadBalancer: schemas.loadBalancer.parse({})
};
