import { z } from 'zod';
import { Position, type Node } from '@xyflow/svelte';
import { WebContainer } from '@webcontainer/api';
import NetworkIcon from '@lucide/svelte/icons/network';
import * as snapshots from 'virtual:webcontainer-snapshots';
import LoadBalancerConfig from './LoadBalancerConfig.svelte';
import type { UpstreamContext, NodeHandleConfig, ResourceDefinition } from '../types';
import { processHandle } from '../shared';

const configSchema = z.object({
	name: z.string().min(1).default('Load Balancer')
});

async function updateTargets(
	node: Node,
	webContainer: WebContainer,
	{ upstreams }: UpstreamContext
) {
	const upstreamPorts = upstreams.flatMap(({ instances }) =>
		instances.filter((instance) => instance.status === 'running').map((instance) => instance.port)
	);
	// An update can reach a load balancer whose start has not mounted it yet
	await webContainer.fs.mkdir(node.id, { recursive: true });
	await webContainer.fs.writeFile(`${node.id}/targets.json`, JSON.stringify(upstreamPorts));
}

export const loadBalancer = {
	name: 'Load Balancer',
	icon: NetworkIcon,
	snapshot: snapshots.loadBalancer,
	hasEditableFiles: false,
	handles: [
		{ type: 'target', position: Position.Left },
		{ type: 'source', position: Position.Right }
	] satisfies NodeHandleConfig[],
	configComponent: LoadBalancerConfig,
	configSchema,
	instanceCount: () => 1,
	start: async (node: Node, webContainer: WebContainer, port: number, context: UpstreamContext) => {
		// Written before the process spawns so its first request already has the right targets
		await updateTargets(node, webContainer, context);
		const process = await webContainer.spawn('node', ['server.js'], {
			cwd: node.id,
			env: { PORT: port }
		});
		return processHandle(process);
	},
	update: updateTargets
} satisfies ResourceDefinition;
