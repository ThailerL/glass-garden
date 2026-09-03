import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import FunctionIcon from '@lucide/svelte/icons/square-function';
import * as resourceFiles from 'virtual:resource-files';
import FunctionConfig from './FunctionConfig.svelte';
import type { Capture, ConnectedNode, ResourceDefinition } from '../types';
import { npmInstall, processHandle } from '../shared';
import { consumerEnv } from '../env';
import { activeProjectDirectory, mountSharedFiles, nodeDirectory } from '$lib/container';
import { nodeConfig } from '$lib/graph-state.svelte';
import { queueUrlFor } from '$lib/aws-region';
import { awsResourceOf } from '$lib/aws-topology';

const configSchema = z.object({
	name: z.string().min(1).default('Function'),
	// Lambda's own default and ceiling
	timeout: z.coerce.number().min(1).max(900).default(3),
	maxConcurrency: z.coerce.number().int().min(1).max(20).default(5)
});

export type Config = z.infer<typeof configSchema>;

const MANAGER_DIRECTORY = 'function-manager';

// The function's own name, which the manager reports to the handler as its identity - AWS's
// own reserved variable, not a grant from a connection, so it travels outside consumerEnv
function ownEnv(node: Node) {
	return { AWS_LAMBDA_FUNCTION_NAME: nodeConfig<Config>(node).name };
}

function launchConfig(node: Node, neighbours: readonly ConnectedNode[]) {
	return { env: { ...ownEnv(node), ...consumerEnv(node, neighbours) } };
}

type LaunchConfig = ReturnType<typeof launchConfig>;

// What the manager re-reads on its own: the trigger queues pointing at this function and the
// limits
async function writeConfig(node: Node, container: Vivari, triggers: unknown[]) {
	const { timeout, maxConcurrency } = nodeConfig<Config>(node);
	// An update can reach a function whose start has not mounted it yet
	await container.fs.mkdir(nodeDirectory(node.id), { recursive: true });
	await container.fs.writeFile(
		`${nodeDirectory(node.id)}/config.json`,
		JSON.stringify({ timeout, maxConcurrency, triggers })
	);
}

export const lambdaFunction = {
	name: 'Function (Lambda)',
	icon: FunctionIcon,
	files: resourceFiles.lambdaFunction,
	hasEditableFiles: true,
	hasPreview: true,
	ownsStoredData: false,
	provides: ['http', 'invoke'],
	consumes: ['sql', 'aws'],
	configComponent: FunctionConfig,
	configSchema,
	metricDefaults: { 'concurrent executions': 'Average' },
	// The one instance is the manager; execution environments spawned inside the manager
	instanceCount: () => 1,
	runsProcesses: true,
	instanceLabel: 'manager',
	launchConfig,
	ownEnv,
	prepare: async (node: Node, container: Vivari, capture: Capture) => {
		await Promise.all([
			mountSharedFiles(MANAGER_DIRECTORY, resourceFiles.functionManager),
			npmInstall(node, container, capture)
		]);
	},
	start: async (
		node: Node,
		container: Vivari,
		port: number,
		_targets: readonly ConnectedNode[],
		config: unknown
	) => {
		const { env } = config as LaunchConfig;
		// Written before the process spawns so its first invocation already has the node's
		// limits; the triggers follow from the update this pass makes next
		await writeConfig(node, container, []);
		const process = await container.spawn(
			'node',
			[`${activeProjectDirectory()}/${MANAGER_DIRECTORY}/manager.mjs`],
			{ cwd: nodeDirectory(node.id), env: { PORT: String(port), ...env } }
		);
		return processHandle(process);
	},
	// A running queue pointing at this function is an event source mapping for the manager
	// to poll
	update: async (
		node: Node,
		container: Vivari,
		_targets: readonly ConnectedNode[],
		sources: readonly ConnectedNode[]
	) => {
		const triggers = sources.flatMap(({ node, instances }) => {
			const resource = awsResourceOf(node);
			if (resource?.service !== 'sqs') return [];
			if (!instances.some((instance) => instance.status === 'running')) return [];
			return [{ queueName: resource.resourceName, queueUrl: queueUrlFor(resource.resourceName) }];
		});
		await writeConfig(node, container, triggers);
	}
} satisfies ResourceDefinition;
