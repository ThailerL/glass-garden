import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import FunctionIcon from '@lucide/svelte/icons/square-function';
import * as resourceFiles from 'virtual:resource-files';
import FunctionConfig from './FunctionConfig.svelte';
import type { ConnectedNode, ResourceDefinition } from '../types';
import { npmInstall, slugify } from '../shared';
import { consumerEnv } from '../env';
import { nodeDirectory } from '$lib/container';
import { nodeConfig } from '$lib/graph-state.svelte';
import {
	deprovisionResource,
	ensureRegion,
	provisionResource,
	regionLifetime
} from '$lib/aws-region';
import { awsResourceOf } from '$lib/aws-topology';

// Lambda's own rule for a function name
export const functionNameSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, numbers, hyphens and underscores');

export function toFunctionName(displayName: string) {
	return slugify(displayName, { separator: '-', case: 'lower', maxLength: 64 });
}

const configSchema = z.object({
	name: z.string().min(1).default('Function'),
	functionName: functionNameSchema.default('function'),
	// Lambda's own default and ceiling
	timeout: z.coerce.number().min(1).max(900).default(3),
	maxConcurrency: z.coerce.number().int().min(1).max(20).default(5)
});

export type Config = z.infer<typeof configSchema>;

const functionNameOf = (node: Node) => nodeConfig<Config>(node).functionName;

// The function's own name, which the region reports to the handler as its identity - AWS's
// own reserved variable, not a grant from a connection, so it travels outside consumerEnv
function ownEnv(node: Node) {
	return { AWS_LAMBDA_FUNCTION_NAME: functionNameOf(node) };
}

// The queues pointing at this function are its event source mappings. A function among the
// sources is a caller the topology grants, not an event source
const triggerQueues = (neighbours: readonly ConnectedNode[]) =>
	neighbours
		.map(({ node }) => awsResourceOf(node))
		.filter((resource) => resource?.service === 'sqs')
		.map((resource) => resource!.resourceName)
		.sort();

// Everything the function is deployed with. A change to any of it is a fresh deploy through
// the same stamp mechanism that relaunches a process
function launchConfig(node: Node, neighbours: readonly ConnectedNode[]) {
	const { timeout, maxConcurrency } = nodeConfig<Config>(node);
	return {
		env: { ...ownEnv(node), ...consumerEnv(node, neighbours) },
		timeout,
		maxConcurrency,
		queues: triggerQueues(neighbours)
	};
}

type LaunchConfig = ReturnType<typeof launchConfig>;

// The region zips the node directory and creates or updates the function from it, sending
// only what changed since the last deploy
async function deploy(node: Node, config: LaunchConfig) {
	await ensureRegion();
	await provisionResource('lambda', functionNameOf(node), {
		directory: nodeDirectory(node.id),
		...config
	});
}

export const lambdaFunction = {
	name: 'Function (Lambda)',
	icon: FunctionIcon,
	files: resourceFiles.lambdaFunction,
	hasEditableFiles: true,
	hasPreview: true,
	// Invoked through the region like any AWS resource, so a caller uses it under 'aws'
	provides: ['http', 'invoke', 'aws'],
	consumes: ['sql', 'aws'],
	aws: { service: 'lambda', resourceKey: 'functionName' },
	configComponent: FunctionConfig,
	loadTestTab: () => import('./TestTab.svelte'),
	configSchema,
	namedOnCreate: {
		title: 'Add a function',
		description: 'Name the node and the function it creates.',
		fields: [
			{
				field: 'name',
				label: 'Display name',
				description: 'What this node is called on the canvas. You can change it later.'
			},
			{
				field: 'functionName',
				label: 'Function name',
				description:
					'What your code passes to the AWS SDK to invoke it. Lambda has no rename, so this one is permanent. Letters, numbers, hyphens and underscores.',
				emphasis: 'permanent',
				derive: { from: 'name', value: toFunctionName },
				unique: true
			}
		]
	},
	// Lambda's own guidance for ConcurrentExecutions: a level sampled at every start and finish
	// averages to nothing meaningful, while its peak is the number of environments in use
	// `errors` and `cold starts` are a 1 or a 0 per invocation, so their average is a rate
	metricDefaults: {
		'concurrent executions': 'Maximum',
		errors: 'Average',
		'cold starts': 'Average'
	},
	gaugeLabel: 'Running invocations, against max concurrency',
	// One slot, holding the port the region serves the function URL on; the execution
	// environments run inside the region, so nothing of the node's own listens
	instanceCount: () => 1,
	runsProcesses: false,
	// Deployed rather than run: it exists from the moment the node does, as on Lambda
	alwaysOn: true,
	launchConfig,
	ownEnv,
	supplies: (node: Node) => ({
		suffix: 'FUNCTION_NAME',
		value: functionNameOf(node),
		soleName: 'LAMBDA_FUNCTION_NAME'
	}),
	// The handler's dependencies go into the package, so they are installed before the deploy
	prepare: (node: Node, container: Vivari, capture) => npmInstall(node, container, capture),
	// A deploy is the whole of starting it, so there is no server to wait for; the URL on the
	// node's port comes up when the region reads the new canvas
	readyOnStart: true,
	start: async (node: Node, _container: Vivari, _port: number, _targets, config: unknown) => {
		await deploy(node, config as LaunchConfig);
		// The region is what this node is really running on, so its death is the node's
		return regionLifetime();
	},
	// The same deploy, so a saved edit runs from the next cold start
	afterSave: (node: Node, neighbours: readonly ConnectedNode[]) =>
		deploy(node, launchConfig(node, neighbours)),
	remove: async (node: Node) => {
		await ensureRegion();
		await deprovisionResource('lambda', functionNameOf(node));
	}
} satisfies ResourceDefinition;
