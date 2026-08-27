import { z } from 'zod';
import type { Component } from 'svelte';
import { WebContainer, type WebContainerProcess } from '@webcontainer/api';
import { Position, type Edge, type Node } from '@xyflow/svelte';
import type { LucideIcon } from '@lucide/svelte';
import ServerIcon from '@lucide/svelte/icons/server';
import NetworkIcon from '@lucide/svelte/icons/network';
import * as ConfigComponents from './components/node-configs';
import * as snapshots from 'virtual:webcontainer-snapshots';
import type { Instance } from './orchestrator.svelte';

type HandleConfig = { type: 'source' | 'target'; position: Position };

// Read-only view of the graph, so a resource can resolve what it points at without
// reaching into the orchestrator
export type EventContext = {
	outgoingEdges: Edge[];
	getInstances: (nodeId: string) => Instance[];
};

export type ResourceDefinition = {
	name: string;
	icon: LucideIcon;
	// Mounted for every resource. hasEditableFiles only decides whether the editor exposes them
	snapshot: Uint8Array;
	hasEditableFiles: boolean;
	handles: HandleConfig[];
	configComponent: Component<{ form: unknown }>;
	configSchema: z.ZodObject<z.ZodRawShape>;
	instanceCount: (node: Node) => number;
	prepare?: (node: Node, webContainer: WebContainer) => Promise<void>;
	start: (
		node: Node,
		webContainer: WebContainer,
		port: number,
		context: EventContext
	) => Promise<WebContainerProcess>;
	// Called when something this resource points at changes, so it can rewrite whatever
	// config its running process reads
	update?: (node: Node, webContainer: WebContainer, context: EventContext) => Promise<void>;
	stop: (process: WebContainerProcess) => Promise<void>;
};

const instanceGroupConfigSchema = z.object({
	name: z.string().min(1).default('Instance Group'),
	instanceCount: z.number().int().positive().default(3),
	command: z.string().min(1).default('npm run start')
});

const loadBalancerConfigSchema = z.object({
	name: z.string().min(1).default('Load Balancer')
});

async function npmInstall(node: Node, webContainer: WebContainer) {
	const installProcess = await webContainer.spawn('npm', ['install'], { cwd: node.id });
	if ((await installProcess.exit) !== 0) {
		throw new Error('Unable to run npm install');
	}
}

async function updateLoadBalancer(
	node: Node,
	webContainer: WebContainer,
	{ outgoingEdges, getInstances }: EventContext
) {
	const upstreamPorts = outgoingEdges.flatMap((edge) => {
		const healthyTargets = getInstances(edge.target).filter(
			(instance) => instance.status === 'running'
		);
		return healthyTargets.map((instance) => instance.port);
	});
	// updateDependents can reach a load balancer whose start has not mounted it yet
	await webContainer.fs.mkdir(node.id, { recursive: true });
	await webContainer.fs.writeFile(`${node.id}/targets.json`, JSON.stringify(upstreamPorts));
}

export const resourceDefinitions = {
	instanceGroup: {
		name: 'Instance Group',
		icon: ServerIcon,
		snapshot: snapshots.instanceGroup,
		hasEditableFiles: true,
		handles: [{ type: 'target', position: Position.Left }] satisfies HandleConfig[],
		configComponent: ConfigComponents.InstanceGroupConfig,
		configSchema: instanceGroupConfigSchema,
		instanceCount: (node: Node) =>
			(node.data as z.infer<typeof instanceGroupConfigSchema>).instanceCount,
		// Runs once per group rather than once per instance, so instances don't race each other
		prepare: async (node: Node, webContainer: WebContainer) => await npmInstall(node, webContainer),
		start: async (node: Node, webContainer: WebContainer, port: number) => {
			// Split command by whitespace
			const { command } = node.data as z.infer<typeof instanceGroupConfigSchema>;
			const commandParts = command.match(/\S+/g);
			if (!commandParts) {
				throw new Error('Command is empty');
			}
			return await webContainer.spawn(commandParts[0], commandParts.slice(1), {
				cwd: node.id,
				env: { PORT: port }
			});
		},
		stop: async (process: WebContainerProcess) => {
			process.kill();
			await process.exit;
		}
	},
	loadBalancer: {
		name: 'Load Balancer',
		icon: NetworkIcon,
		snapshot: snapshots.loadBalancer,
		hasEditableFiles: false,
		handles: [
			{ type: 'target', position: Position.Left },
			{ type: 'source', position: Position.Right }
		] satisfies HandleConfig[],
		configComponent: ConfigComponents.LoadBalancerConfig,
		configSchema: loadBalancerConfigSchema,
		instanceCount: () => 1,
		start: async (node: Node, webContainer: WebContainer, port: number, context: EventContext) => {
			// Written before the process spawns so its first request already has the right targets
			await updateLoadBalancer(node, webContainer, context);
			return await webContainer.spawn('node', ['server.js'], {
				cwd: node.id,
				env: { PORT: port }
			});
		},
		update: updateLoadBalancer,
		stop: async (process: WebContainerProcess) => {
			process.kill();
			await process.exit;
		}
	}
} satisfies Record<string, ResourceDefinition>;

export type ResourceType = keyof typeof resourceDefinitions;

// Only the type is used, so this also accepts a bare NodeProps from a node component
export function getResourceDefinition(node: Pick<Node, 'type'>): ResourceDefinition {
	const definition = resourceDefinitions[node.type as ResourceType];
	if (!definition) {
		throw new Error(`Unknown resource type: ${node.type}`);
	}
	return definition;
}
