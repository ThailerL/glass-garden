import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import LoadBalancerIcon from './LoadBalancerIcon.svelte';
import * as resourceFiles from 'virtual:resource-files';
import HttpLoadBalancerConfig from './HttpLoadBalancerConfig.svelte';
import type { ConnectedNode, ResourceDefinition } from '../types';
import { providing } from '../index';
import { processHandle } from '../shared';
import { nodeDirectory } from '$lib/container';
import { nodeConfig } from '$lib/graph-state.svelte';

// ALB's Matcher, "200,204,300-399". Rejected here because the balancer fails closed on one it
// cannot parse, which would take every target out at once
const matcherSchema = z
	.string()
	.regex(
		/^\s*\d{3}\s*(-\s*\d{3}\s*)?(,\s*\d{3}\s*(-\s*\d{3}\s*)?)*$/,
		'Use status codes and ranges, like "200,300-399"'
	);

const configSchema = z
	.object({
		name: z.string().min(1).default('HTTP Load Balancer'),
		algorithm: z.enum(['round-robin', 'random']).default('round-robin'),
		// ALB's own limits; the defaults are faster, so an experiment here is a minute long
		healthCheckPath: z.string().startsWith('/', 'Must start with /').default('/'),
		healthCheckInterval: z.coerce.number().int().min(5).max(300).default(5),
		healthCheckTimeout: z.coerce.number().int().min(2).max(120).default(2),
		healthyThreshold: z.coerce.number().int().min(2).max(10).default(2),
		unhealthyThreshold: z.coerce.number().int().min(2).max(10).default(2),
		matcher: matcherSchema.default('200')
	})
	// ALB's rule. A check still running when the next one is due would never settle
	.check((ctx) => {
		if (ctx.issues.length > 0) return;
		if (ctx.value.healthCheckTimeout < ctx.value.healthCheckInterval) return;
		ctx.issues.push({
			code: 'custom',
			input: ctx.value.healthCheckTimeout,
			path: ['healthCheckTimeout'],
			message: 'Must be less than the interval'
		});
	});

export type Config = z.infer<typeof configSchema>;

export const ADVANCED_FIELDS = [
	'healthCheckTimeout',
	'healthyThreshold',
	'unhealthyThreshold',
	'matcher'
] as const satisfies readonly (keyof Config)[];

// An error under a closed disclosure blocks a save with nothing on screen to explain it
export function hasAdvancedError(errors: Record<string, unknown>) {
	return ADVANCED_FIELDS.some((field) => errors[field] !== undefined);
}

// Short names in the file the balancer reads, where every setting is a health check one
function healthCheckOf(config: Config) {
	return {
		path: config.healthCheckPath,
		interval: config.healthCheckInterval,
		timeout: config.healthCheckTimeout,
		healthyThreshold: config.healthyThreshold,
		unhealthyThreshold: config.unhealthyThreshold,
		matcher: config.matcher
	};
}

// The targets and the algorithm travel in one file, so the running process can never read
// a rotation that disagrees with the set it is rotating over
async function updateConfig(node: Node, container: Vivari, connected: readonly ConnectedNode[]) {
	const targets = providing(connected, 'http').flatMap(({ instances }) =>
		instances.filter((instance) => instance.status === 'running').map((instance) => instance.port)
	);
	const config = nodeConfig<Config>(node);
	// An update can reach a load balancer whose start has not mounted it yet
	await container.fs.mkdir(nodeDirectory(node.id), { recursive: true });
	await container.fs.writeFile(
		`${nodeDirectory(node.id)}/config.json`,
		JSON.stringify({ algorithm: config.algorithm, targets, healthCheck: healthCheckOf(config) })
	);
}

export const httpLoadBalancer = {
	name: 'HTTP Load Balancer',
	icon: LoadBalancerIcon,
	files: resourceFiles.httpLoadBalancer,
	hasEditableFiles: false,
	hasPreview: true,
	ownsStoredData: false,
	provides: ['http'],
	consumes: ['http'],
	configComponent: HttpLoadBalancerConfig,
	configSchema,
	instanceCount: () => 1,
	runsProcesses: true,
	start: async (node: Node, container: Vivari, port: number, targets: readonly ConnectedNode[]) => {
		// Written before the process spawns so its first request already has the right targets
		await updateConfig(node, container, targets);
		const process = await container.spawn('node', ['server.js'], {
			cwd: nodeDirectory(node.id),
			env: { PORT: String(port) }
		});
		return processHandle(process);
	},
	update: updateConfig
} satisfies ResourceDefinition;
