import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/svelte';
import { accessKeyFor, buildTopology } from './aws-topology';

const node = (id: string, type: string, config: Record<string, unknown>): Node =>
	({ id, type, position: { x: 0, y: 0 }, data: { config } }) as unknown as Node;

const bucket = (id: string, name: string, bucketName: string) =>
	node(id, 's3Bucket', { name, bucketName });
const queue = (id: string, name: string, queueName: string) =>
	node(id, 'sqsQueue', { name, queueName, visibilityTimeout: 30 });
const table = (id: string, name: string, tableName: string) =>
	node(id, 'dynamodbTable', { name, tableName, partitionKey: 'pk' });
const app = (id: string, name: string) =>
	node(id, 'instanceGroup', { name, instanceCount: 1, command: 'npm start' });
const edge = (source: string, target: string): Edge => ({
	id: `${source}-${target}`,
	source,
	target
});

describe('buildTopology', () => {
	it('grants a consumer only the buckets it has edges to', () => {
		const nodes = [
			app('a', 'Web'),
			bucket('b1', 'Assets', 'assets'),
			bucket('b2', 'Backups', 'backups')
		];
		const topology = buildTopology(nodes, [edge('a', 'b1')]);
		expect(topology.services).toEqual(['s3']);
		expect(topology.principals[accessKeyFor('a')]).toMatchObject({
			nodeId: 'a',
			name: 'Web',
			resources: { s3: ['assets'], sqs: [], dynamodb: [] }
		});
	});

	it('grants each service separately, so one edge does not unlock the others', () => {
		const nodes = [app('a', 'Web'), queue('q1', 'Orders', 'orders'), table('t1', 'Users', 'users')];
		const topology = buildTopology(nodes, [edge('a', 'q1')]);
		expect(topology.services).toEqual(['dynamodb', 'sqs']);
		expect(topology.principals[accessKeyFor('a')].resources).toEqual({
			s3: [],
			sqs: ['orders'],
			dynamodb: []
		});
		expect(topology.owners).toEqual({ s3: {}, sqs: { orders: 'q1' }, dynamodb: { users: 't1' } });
	});

	it('grants a node the queue pointing at it, though the edge runs the other way', () => {
		const topology = buildTopology(
			[app('a', 'Worker'), queue('q1', 'Orders', 'orders')],
			[edge('q1', 'a')]
		);
		expect(topology.principals[accessKeyFor('a')].resources.sqs).toEqual(['orders']);
		expect(topology.principals[accessKeyFor('q1')]).toBeUndefined();
	});

	it('gives a resource node no principal of its own: it runs no code and gets no credentials', () => {
		const topology = buildTopology([bucket('b1', 'Assets', 'assets')], []);
		expect(topology.principals).toEqual({});
		expect(topology.owners.s3).toEqual({ assets: 'b1' });
	});

	it('gives a caller with no aws edges a principal granting nothing, so denials can name it', () => {
		const topology = buildTopology([app('a', 'Web'), bucket('b1', 'Assets', 'assets')], []);
		expect(topology.principals[accessKeyFor('a')]).toMatchObject({
			nodeId: 'a',
			name: 'Web',
			resources: { s3: [], sqs: [], dynamodb: [] }
		});
	});

	it('grants nothing for an edge to a resource that is not aws', () => {
		const nodes = [app('a', 'Web'), node('p', 'postgres', { name: 'DB', maxConnections: 10 })];
		const topology = buildTopology(nodes, [edge('a', 'p')]);
		expect(topology.principals[accessKeyFor('a')].resources.s3).toEqual([]);
	});

	it('skips a bucket whose name is not set yet', () => {
		const topology = buildTopology([bucket('b1', 'Assets', '')], []);
		expect(topology.services).toEqual([]);
		expect(topology.owners.s3).toEqual({});
	});

	it('sorts names so an unchanged canvas produces an identical document', () => {
		const nodes = [app('a', 'Web'), bucket('b1', 'Z', 'zebra'), bucket('b2', 'A', 'apple')];
		const forward = buildTopology(nodes, [edge('a', 'b1'), edge('a', 'b2')]);
		const reversed = buildTopology(nodes, [edge('a', 'b2'), edge('a', 'b1')]);
		expect(forward.principals[accessKeyFor('a')].resources.s3).toEqual(['apple', 'zebra']);
		expect(forward).toEqual(reversed);
	});

	it('keeps the whole node id, so two nodes can never share one key', () => {
		expect(accessKeyFor('a-b_c9')).toBe('gga-b_c9');
		expect(accessKeyFor('abc-defg')).not.toBe(accessKeyFor('abcd-efg'));
	});
});
