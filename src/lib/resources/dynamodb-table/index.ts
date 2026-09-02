import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import TableIcon from '@lucide/svelte/icons/table-2';
import TableConfig from './TableConfig.svelte';
import type { ResourceDefinition } from '../types';
import { slugify } from '../shared';
import { nodeConfig } from '$lib/graph-state.svelte';
import { deprovisionResource, ensureRegion, provisionResource, regionExit } from '$lib/aws-region';

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

export const dynamodbTable = {
	name: 'Table (DynamoDB)',
	icon: TableIcon,
	files: {},
	hasEditableFiles: false,
	hasPreview: false,
	ownsStoredData: true,
	provides: ['aws'],
	consumes: [],
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
	metricDefaults: { items: 'Average' },
	instanceCount: () => 1,
	runsProcesses: false,
	launchConfig,
	supplies: (node: Node) => ({
		suffix: 'TABLE',
		value: tableNameOf(node),
		soleName: 'DYNAMODB_TABLE'
	}),
	// A table is not a process. Provisioning it is the whole of starting it, so there is no
	// server to wait for and the region reports what the table holds on the node's behalf
	readyOnStart: true,
	start: async (_node: Node, _container: Vivari, _port: number, _upstreams, config: unknown) => {
		const { tableName, partitionKey } = config as LaunchConfig;
		await ensureRegion();
		await provisionResource('dynamodb', tableName, {
			keySchema: [{ AttributeName: partitionKey, KeyType: 'HASH' }],
			attributeDefinitions: [{ AttributeName: partitionKey, AttributeType: 'S' }]
		});
		// The region is what this node is really running on, so its death is the node's
		const death = regionExit();
		return { exited: death.exited, stop: async () => death.cancel() };
	},
	remove: async (node: Node) => {
		await ensureRegion();
		await deprovisionResource('dynamodb', tableNameOf(node));
	}
} satisfies ResourceDefinition;
