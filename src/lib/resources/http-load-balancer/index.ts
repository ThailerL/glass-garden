import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import LoadBalancerIcon from './LoadBalancerIcon.svelte';
import * as resourceFiles from 'virtual:resource-files';
import HttpLoadBalancerConfig from './HttpLoadBalancerConfig.svelte';
import type { ConnectedNode, ResourceDefinition } from '../types';
import { upstreamsProviding } from '../index';
import { processHandle } from '../shared';
import { nodeDirectory } from '$lib/container';
import { nodeConfig } from '$lib/graph-state.svelte';

const configSchema = z.object({
	name: z.string().min(1).default('HTTP Load Balancer'),
	algorithm: z.enum(['round-robin', 'random']).default('round-robin')
});

export type Config = z.infer<typeof configSchema>;

// The targets and the algorithm travel in one file, so the running process can never read
// a rotation that disagrees with the set it is rotating over
async function updateConfig(node: Node, container: Vivari, upstreams: readonly ConnectedNode[]) {
	const targets = upstreamsProviding(upstreams, 'http').flatMap(({ instances }) =>
		instances.filter((instance) => instance.status === 'running').map((instance) => instance.port)
	);
	const { algorithm } = nodeConfig<Config>(node);
	// An update can reach a load balancer whose start has not mounted it yet
	await container.fs.mkdir(nodeDirectory(node.id), { recursive: true });
	await container.fs.writeFile(
		`${nodeDirectory(node.id)}/config.json`,
		JSON.stringify({ algorithm, targets })
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
	metricDefaults: { requests: 'Sum', failures: 'Sum', latency: 'Average' },
	instanceCount: () => 1,
	runsProcesses: true,
	start: async (
		node: Node,
		container: Vivari,
		port: number,
		upstreams: readonly ConnectedNode[]
	) => {
		// Written before the process spawns so its first request already has the right targets
		await updateConfig(node, container, upstreams);
		const process = await container.spawn('node', ['server.js'], {
			cwd: nodeDirectory(node.id),
			env: { PORT: String(port) }
		});
		return processHandle(process);
	},
	update: updateConfig
} satisfies ResourceDefinition;
