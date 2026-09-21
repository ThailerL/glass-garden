import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import TableIcon from '@lucide/svelte/icons/table-2';
import TableConfig from './TableConfig.svelte';
import type { ResourceDefinition, Scalar } from '../types';
import { slugify } from '../shared';
import { nodeConfig } from '$lib/graph-state.svelte';
import {
	callAws,
	deprovisionResource,
	ensureRegion,
	provisionResource,
	regionLifetime
} from '$lib/aws-region';

// DynamoDB's own rules, which the AWS SDK enforces client-side too
export const tableNameSchema = z
	.string()
	.min(3)
	.max(255)
	.regex(/^[a-zA-Z0-9_.-]+$/, 'Use letters, numbers, dots, hyphens and underscores');

// An attribute name the key schema can refer to. Deliberately narrower than DynamoDB
// allows, which is nearly anything: a key named with a space or a dot needs expression
// placeholders in every query, which is not a lesson a first table should teach
const attributeNameSchema = z
	.string()
	.max(255)
	.regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Start with a letter, then letters, numbers or underscores');

export function toTableName(displayName: string) {
	return slugify(displayName, { separator: '-', case: 'lower', maxLength: 255 });
}

const configSchema = z.object({
	name: z.string().min(1).default('Table'),
	tableName: tableNameSchema.default('my-table'),
	partitionKey: attributeNameSchema.default('pk')
});

export type Config = z.infer<typeof configSchema>;

const tableNameOf = (node: Node) => nodeConfig<Config>(node).tableName;

function launchConfig(node: Node) {
	const { tableName, partitionKey } = nodeConfig<Config>(node);
	return { tableName, partitionKey };
}

type LaunchConfig = ReturnType<typeof launchConfig>;

// A list, map or binary attribute has no scalar to offer, so it is left out
function flatten(item: Record<string, Record<string, unknown>>): Record<string, Scalar> {
	const flat: Record<string, Scalar> = {};
	for (const [name, value] of Object.entries(item)) {
		if (typeof value.S === 'string') flat[name] = value.S;
		else if (typeof value.N === 'string') flat[name] = Number(value.N);
		else if (typeof value.BOOL === 'boolean') flat[name] = value.BOOL;
	}
	return flat;
}

function provision({ tableName, partitionKey }: LaunchConfig) {
	return provisionResource('dynamodb', tableName, {
		keySchema: [{ AttributeName: partitionKey, KeyType: 'HASH' }],
		attributeDefinitions: [{ AttributeName: partitionKey, AttributeType: 'S' }]
	});
}

export const dynamodbTable = {
	name: 'Table (DynamoDB)',
	icon: TableIcon,
	files: {},
	hasEditableFiles: false,
	hasPreview: false,
	provides: ['aws'],
	consumes: [],
	aws: { service: 'dynamodb', resourceKey: 'tableName' },
	configComponent: TableConfig,
	configSchema,
	namedOnCreate: {
		title: 'Add a table',
		description: 'Name the node, the table it creates, and the attribute its items are keyed by.',
		fields: [
			{
				field: 'name',
				label: 'Display name',
				description: 'What this node is called on the canvas. You can change it later.'
			},
			{
				field: 'tableName',
				label: 'Table name',
				description:
					'What your code passes to the AWS SDK. DynamoDB has no rename, so this one is permanent. Letters, numbers, dots, hyphens and underscores.',
				emphasis: 'permanent',
				derive: { from: 'name', value: toTableName },
				unique: true
			},
			{
				field: 'partitionKey',
				label: 'Partition key',
				description:
					'The attribute every item is found by, a string. A table is keyed once and for all, so this one is permanent too.',
				emphasis: 'permanent',
				initial: 'pk'
			}
		]
	},
	// `errors` is a 1 or a 0 per call, so the average is the share that were refused
	metricDefaults: { items: 'Average', errors: 'Average' },
	instanceCount: () => 1,
	runsProcesses: false,
	alwaysOn: true,
	launchConfig,
	supplies: (node: Node) => ({
		suffix: 'TABLE',
		value: tableNameOf(node),
		soleName: 'DYNAMODB_TABLE'
	}),
	// A table is not a process. Provisioning it is the whole of starting it, so there is no
	// server to wait for and the region reports what the table holds on the node's behalf
	readyOnStart: true,
	start: async (_node: Node, _container: Vivari, _port: number, _targets, config: unknown) => {
		await ensureRegion();
		await provision(config as LaunchConfig);
		// The region is what this node is really running on, so its death is the node's
		return regionLifetime();
	},
	remove: async (node: Node) => {
		await ensureRegion();
		await deprovisionResource('dynamodb', tableNameOf(node));
	},
	reads: {
		item: {
			// The key attribute is provisioned as a string, so a number never matches
			args: z.strictObject({ key: z.string().min(1) }),
			read: async (node: Node, { key }: Record<string, Scalar>) => {
				const { tableName, partitionKey } = launchConfig(node);
				const answer = await callAws('dynamodb', 'DynamoDB_20120810.GetItem', {
					TableName: tableName,
					Key: { [partitionKey]: { S: key } }
				});
				// A missing item is a 200 with no Item, not an error
				return answer.Item === undefined
					? undefined
					: flatten(answer.Item as Record<string, Record<string, unknown>>);
			}
		}
	},
	// Recreated rather than truncated: the region has no truncate, and start cannot do it because
	// an always-on node is already running by the time a run begins
	clear: async (node: Node) => {
		await ensureRegion();
		await deprovisionResource('dynamodb', tableNameOf(node));
		await provision(launchConfig(node));
	}
} satisfies ResourceDefinition;
