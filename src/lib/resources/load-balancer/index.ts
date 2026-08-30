import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import NetworkIcon from '@lucide/svelte/icons/network';
import * as resourceFiles from 'virtual:resource-files';
import LoadBalancerConfig from './LoadBalancerConfig.svelte';
import type { Upstream, ResourceDefinition } from '../types';
import { upstreamsProviding } from '../index';
import { processHandle } from '../shared';
import { nodeDirectory } from '$lib/container';

const configSchema = z.object({
	name: z.string().min(1).default('Load Balancer')
});

async function updateTargets(node: Node, container: Vivari, upstreams: readonly Upstream[]) {
	const upstreamPorts = upstreamsProviding(upstreams, 'http').flatMap(({ instances }) =>
		instances.filter((instance) => instance.status === 'running').map((instance) => instance.port)
	);
	// An update can reach a load balancer whose start has not mounted it yet
	await container.fs.mkdir(nodeDirectory(node.id), { recursive: true });
	await container.fs.writeFile(
		`${nodeDirectory(node.id)}/targets.json`,
		JSON.stringify(upstreamPorts)
	);
}

export const loadBalancer = {
	name: 'Load Balancer',
	icon: NetworkIcon,
	files: resourceFiles.loadBalancer,
	hasEditableFiles: false,
	hasPreview: true,
	provides: ['http'],
	consumes: ['http'],
	configComponent: LoadBalancerConfig,
	configSchema,
	instanceCount: () => 1,
	start: async (node: Node, container: Vivari, port: number, upstreams: readonly Upstream[]) => {
		// Written before the process spawns so its first request already has the right targets
		await updateTargets(node, container, upstreams);
		const process = await container.spawn('node', ['server.js'], {
			cwd: nodeDirectory(node.id),
			env: { PORT: String(port) }
		});
		return processHandle(process);
	},
	update: updateTargets
} satisfies ResourceDefinition;
