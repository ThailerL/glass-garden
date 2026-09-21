import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import BucketIcon from '@lucide/svelte/icons/archive';
import BucketConfig from './BucketConfig.svelte';
import type { ConnectedNode, ResourceDefinition } from '../types';
import { providing } from '../index';
import { slugify } from '../shared';
import { nodeConfig } from '$lib/graph-state.svelte';
import {
	deprovisionResource,
	ensureRegion,
	provisionResource,
	regionLifetime
} from '$lib/aws-region';
import { awsResourceOf } from '$lib/aws-topology';

// S3's own rules, which the AWS SDK enforces client-side too: a name that passes here is
// one the user could take to real AWS
export const bucketNameSchema = z
	.string()
	.min(3)
	.max(63)
	.regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, 'Use lowercase letters, numbers, dots and hyphens')
	.refine((name) => !/\.\./.test(name) && !/^\d+(\.\d+){3}$/.test(name), {
		message: 'Cannot contain ".." or look like an IP address'
	});

// Not guaranteed valid - "ab" is still too short - so the field still validates like any other
export function toBucketName(displayName: string) {
	return slugify(displayName, { separator: '-', case: 'lower', maxLength: 63 });
}

const configSchema = z.object({
	name: z.string().min(1).default('Bucket'),
	bucketName: bucketNameSchema.default('my-bucket')
});

export type Config = z.infer<typeof configSchema>;

const bucketNameOf = (node: Node) => nodeConfig<Config>(node).bucketName;

function launchConfig(node: Node) {
	return { bucketName: bucketNameOf(node) };
}

type LaunchConfig = ReturnType<typeof launchConfig>;

export const s3Bucket = {
	name: 'Bucket (S3)',
	icon: BucketIcon,
	files: {},
	hasEditableFiles: false,
	hasPreview: false,
	provides: ['aws'],
	// A bucket can point at a function, which then receives an event per object
	consumes: ['invoke'],
	aws: { service: 's3', resourceKey: 'bucketName' },
	configComponent: BucketConfig,
	configSchema,
	namedOnCreate: {
		title: 'Add a bucket',
		description: 'Name the node and the bucket it creates.',
		fields: [
			{
				field: 'name',
				label: 'Display name',
				description: 'What this node is called on the canvas. You can change it later.'
			},
			{
				field: 'bucketName',
				label: 'Bucket name',
				description:
					'What your code passes to the AWS SDK. S3 has no rename, so this one is permanent. Lowercase letters, numbers, dots and hyphens.',
				emphasis: 'permanent',
				derive: { from: 'name', value: toBucketName },
				unique: true
			}
		]
	},
	// `errors` is a 1 or a 0 per call, so the average is the share that were refused
	metricDefaults: { objects: 'Average', errors: 'Average' },
	instanceCount: () => 1,
	runsProcesses: false,
	alwaysOn: true,
	launchConfig,
	supplies: (node: Node) => ({
		suffix: 'BUCKET',
		value: bucketNameOf(node),
		soleName: 'S3_BUCKET'
	}),
	// A bucket is not a process. Provisioning it is the whole of starting it, so there is no
	// server to wait for and the region reports what the bucket holds on the node's behalf
	readyOnStart: true,
	start: async (_node: Node, _container: Vivari, _port: number, _targets, config: unknown) => {
		const { bucketName } = config as LaunchConfig;
		await ensureRegion();
		await provisionResource('s3', bucketName);
		// The region is what this node is really running on, so its death is the node's
		return regionLifetime();
	},
	// The bucket notifies every function it points at, by the function's own name. The
	// emulator checks only the ARN's shape here, so the bucket's update and the function's
	// deploy can run in either order
	update: async (node: Node, _container: Vivari, targets: readonly ConnectedNode[]) => {
		const functions = providing(targets, 'invoke').flatMap(({ node: target }) => {
			const resource = awsResourceOf(target);
			return resource?.service === 'lambda'
				? [{ id: target.id, functionName: resource.resourceName }]
				: [];
		});
		await ensureRegion();
		await provisionResource('s3', bucketNameOf(node), { notifications: functions });
	},
	remove: async (node: Node) => {
		await ensureRegion();
		await deprovisionResource('s3', bucketNameOf(node));
	},
	// Recreated rather than emptied out, since start cannot do it: an always-on node is already
	// running by the time a run begins. The notifications come back with the next update
	clear: async (node: Node) => {
		await ensureRegion();
		await deprovisionResource('s3', bucketNameOf(node));
		await provisionResource('s3', bucketNameOf(node));
	}
} satisfies ResourceDefinition;
