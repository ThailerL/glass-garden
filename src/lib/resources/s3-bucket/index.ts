import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import BucketIcon from '@lucide/svelte/icons/archive';
import BucketConfig from './BucketConfig.svelte';
import type { ResourceDefinition } from '../types';
import { nodeConfig } from '$lib/graph-state.svelte';
import { deprovisionResource, ensureRegion, provisionResource, regionExit } from '$lib/aws-region';

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
	ownsStoredData: true,
	provides: ['aws'],
	consumes: [],
	configComponent: BucketConfig,
	configSchema,
	metricDefaults: { objects: 'avg', 'size (MB)': 'avg', requests: 'sum', errors: 'sum' },
	instanceCount: () => 1,
	runsProcesses: false,
	launchConfig,
	supplies: (node: Node) => ({
		suffix: 'BUCKET',
		value: bucketNameOf(node),
		soleName: 'S3_BUCKET'
	}),
	// A bucket is not a process. Provisioning it is the whole of starting it, so there is no
	// server to wait for and the region reports what the bucket holds on the node's behalf
	readyOnStart: true,
	start: async (_node: Node, _container: Vivari, _port: number, _upstreams, config: unknown) => {
		const { bucketName } = config as LaunchConfig;
		await ensureRegion();
		await provisionResource('s3', bucketName);
		// The region is what this node is really running on, so its death is the node's
		const death = regionExit();
		return { exited: death.exited, stop: async () => death.cancel() };
	},
	// Deleting the bucket needs the emulator
	remove: async (node: Node) => {
		await ensureRegion();
		await deprovisionResource('s3', bucketNameOf(node));
	}
} satisfies ResourceDefinition;
