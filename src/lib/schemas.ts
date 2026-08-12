import { z } from 'zod';

export const schemas = {
	function: z.object({
		name: z.string().min(1).default('Function'),
		runtime: z.enum(['node.js']).default('node.js')
	}),
	service: z.object({
		name: z.string().min(1).default('Service'),
		runtime: z.enum(['node.js']).default('node.js')
	}),
	loadBalancer: z.object({
		name: z.string().min(1).default('Load Balancer'),
		targetGroups: z
			.array(
				z.object({
					id: z.uuid().readonly(),
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
