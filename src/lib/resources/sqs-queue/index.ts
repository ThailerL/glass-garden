import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import QueueIcon from '@lucide/svelte/icons/inbox';
import QueueConfig from './QueueConfig.svelte';
import type { ResourceDefinition } from '../types';
import { slugify } from '../shared';
import { nodeConfig } from '$lib/graph-state.svelte';
import {
	deprovisionResource,
	ensureRegion,
	provisionResource,
	queueUrlFor,
	regionExit
} from '$lib/aws-region';

// SQS's own rules for a standard queue. Dots are not allowed, which also keeps a name from
// ending in ".fifo" and quietly getting first-in-first-out semantics nobody asked for
export const queueNameSchema = z
	.string()
	.min(1)
	.max(80)
	.regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, numbers, hyphens and underscores');

export function toQueueName(displayName: string) {
	return slugify(displayName, { separator: '-', case: 'lower', maxLength: 80 });
}

const configSchema = z.object({
	name: z.string().min(1).default('Queue'),
	queueName: queueNameSchema.default('my-queue'),
	// How long a received message stays hidden from other readers before it comes back
	visibilityTimeout: z.coerce.number().int().min(0).max(43200).default(30)
});

export type Config = z.infer<typeof configSchema>;

const queueNameOf = (node: Node) => nodeConfig<Config>(node).queueName;

function launchConfig(node: Node) {
	const { queueName, visibilityTimeout } = nodeConfig<Config>(node);
	return { queueName, visibilityTimeout };
}

type LaunchConfig = ReturnType<typeof launchConfig>;

export const sqsQueue = {
	name: 'Queue (SQS)',
	icon: QueueIcon,
	files: {},
	hasEditableFiles: false,
	hasPreview: false,
	ownsStoredData: true,
	provides: ['aws'],
	consumes: [],
	configComponent: QueueConfig,
	configSchema,
	namedOnCreate: {
		title: 'Add a queue',
		description: 'Name the node and the queue it creates.',
		fields: [
			{
				field: 'name',
				label: 'Display name',
				description: 'What this node is called on the canvas. You can change it later.'
			},
			{
				field: 'queueName',
				label: 'Queue name',
				description:
					'Part of the URL your code sends messages to. SQS has no rename, so this one is permanent. Letters, numbers, hyphens and underscores.',
				emphasis: 'permanent',
				derive: { from: 'name', value: toQueueName },
				unique: true
			}
		]
	},
	metricDefaults: { messages: 'Average', 'in flight': 'Average', requests: 'Sum', errors: 'Sum' },
	instanceCount: () => 1,
	runsProcesses: false,
	launchConfig,
	// The URL rather than the name: it is what the AWS SDK takes for every call after
	// creation, and it dials the region directly
	supplies: (node: Node) => ({
		suffix: 'QUEUE_URL',
		value: queueUrlFor(queueNameOf(node)),
		soleName: 'SQS_QUEUE_URL'
	}),
	// A queue is not a process. Provisioning it is the whole of starting it, so there is no
	// server to wait for and the region reports what the queue holds on the node's behalf
	readyOnStart: true,
	start: async (_node: Node, _container: Vivari, _port: number, _upstreams, config: unknown) => {
		const { queueName, visibilityTimeout } = config as LaunchConfig;
		await ensureRegion();
		await provisionResource('sqs', queueName, {
			attributes: { VisibilityTimeout: visibilityTimeout }
		});
		// The region is what this node is really running on, so its death is the node's
		const death = regionExit();
		return { exited: death.exited, stop: async () => death.cancel() };
	},
	remove: async (node: Node) => {
		await ensureRegion();
		await deprovisionResource('sqs', queueNameOf(node));
	}
} satisfies ResourceDefinition;
