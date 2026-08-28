import { z } from 'zod';
import { Position, type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import NetworkIcon from '@lucide/svelte/icons/network';
import * as resourceFiles from 'virtual:resource-files';
import LoadBalancerConfig from './LoadBalancerConfig.svelte';
import type { UpstreamContext, NodeHandleConfig, ResourceDefinition } from '../types';
import { processHandle } from '../shared';
import { nodeDirectory } from '../../container';

const configSchema = z.object({
	name: z.string().min(1).default('Load Balancer')
});

async function updateTargets(node: Node, container: Vivari, { upstreams }: UpstreamContext) {
	const upstreamPorts = upstreams.flatMap(({ instances }) =>
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
	handles: [
		{ type: 'target', position: Position.Left },
		{ type: 'source', position: Position.Right }
	] satisfies NodeHandleConfig[],
	configComponent: LoadBalancerConfig,
	configSchema,
	instanceCount: () => 1,
	start: async (node: Node, container: Vivari, port: number, context: UpstreamContext) => {
		// Written before the process spawns so its first request already has the right targets
		await updateTargets(node, container, context);
		const process = await container.spawn('node', ['server.js'], {
			cwd: nodeDirectory(node.id),
			env: { PORT: String(port) }
		});
		return processHandle(process);
	},
	update: updateTargets
} satisfies ResourceDefinition;
