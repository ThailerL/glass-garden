import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/svelte';
import { queueNameSchema, sqsQueue, toQueueName } from './sqs-queue';
import { dynamodbTable, tableNameSchema, toTableName } from './dynamodb-table';

const node = (type: string, config: Record<string, unknown>): Node =>
	({ id: 'n1', type, position: { x: 0, y: 0 }, data: { config } }) as unknown as Node;

describe('queue naming', () => {
	it('derives a usable queue name from a display name', () => {
		expect(toQueueName("Bob's Order Events")).toBe('bobs-order-events');
	});

	it('refuses a dot, so a name cannot quietly ask for a FIFO queue', () => {
		expect(queueNameSchema.safeParse('orders.fifo').success).toBe(false);
		expect(queueNameSchema.safeParse('orders-fifo').success).toBe(true);
	});

	it('supplies the URL the SDK dials, not the bare name', () => {
		const supplied = sqsQueue.supplies(node('sqsQueue', { name: 'Orders', queueName: 'orders' }));
		expect(supplied.value).toMatch(/^http:\/\/localhost:\d+\/\d{12}\/orders$/);
		expect(supplied).toMatchObject({ suffix: 'QUEUE_URL', soleName: 'SQS_QUEUE_URL' });
	});
});

describe('table naming', () => {
	it('derives a usable table name from a display name', () => {
		expect(toTableName('User Sessions')).toBe('user-sessions');
	});

	it('holds to DynamoDB length rules', () => {
		expect(tableNameSchema.safeParse('ab').success).toBe(false);
		expect(tableNameSchema.safeParse('user_sessions.v2').success).toBe(true);
	});

	it('supplies the table name under the conventional variable', () => {
		const supplied = dynamodbTable.supplies(
			node('dynamodbTable', { name: 'Users', tableName: 'users', partitionKey: 'pk' })
		);
		expect(supplied).toEqual({ suffix: 'TABLE', value: 'users', soleName: 'DYNAMODB_TABLE' });
	});
});
