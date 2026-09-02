import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/svelte';
import { accessKeyFor, awsEnv, buildTopology } from './aws-topology';

const node = (id: string, type: string, config: Record<string, unknown>): Node =>
	({ id, type, position: { x: 0, y: 0 }, data: { config } }) as unknown as Node;

const bucket = (id: string, name: string, bucketName: string) =>
	node(id, 's3Bucket', { name, bucketName });
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

	it('gives a resource node no principal of its own: it runs no code and gets no credentials', () => {
		const topology = buildTopology([bucket('b1', 'Assets', 'assets')], []);
		expect(topology.principals).toEqual({});
		expect(topology.owners.s3).toEqual({ assets: 'b1' });
	});

	it('gives a consumer with no aws edges no principal at all', () => {
		const topology = buildTopology([app('a', 'Web'), bucket('b1', 'Assets', 'assets')], []);
		expect(topology.principals[accessKeyFor('a')]).toBeUndefined();
	});

	it('ignores edges to resources that are not aws', () => {
		const nodes = [app('a', 'Web'), node('p', 'postgres', { name: 'DB', maxConnections: 10 })];
		expect(buildTopology(nodes, [edge('a', 'p')]).principals).toEqual({});
	});

	it('skips a bucket whose name is not set yet', () => {
		const topology = buildTopology([bucket('b1', 'Assets', '')], []);
		expect(topology.services).toEqual([]);
		expect(topology.principals).toEqual({});
	});

	it('sorts names so an unchanged canvas produces an identical document', () => {
		const nodes = [app('a', 'Web'), bucket('b1', 'Z', 'zebra'), bucket('b2', 'A', 'apple')];
		const forward = buildTopology(nodes, [edge('a', 'b1'), edge('a', 'b2')]);
		const reversed = buildTopology(nodes, [edge('a', 'b2'), edge('a', 'b1')]);
		expect(forward.principals[accessKeyFor('a')].resources.s3).toEqual(['apple', 'zebra']);
		expect(forward).toEqual(reversed);
	});

	it('makes an access key that survives being put in a credential scope', () => {
		expect(accessKeyFor('a-b_c9')).toBe('ggabc9');
	});
});

describe('awsEnv', () => {
	const consumer = app('a', 'Web');

	it('is empty when nothing aws is connected, so no SDK config leaks in', () => {
		expect(awsEnv(consumer, [])).toEqual({});
	});

	it('supplies the SDK variables plus a named and a conventional bucket variable', () => {
		const env = awsEnv(consumer, [bucket('b1', 'Assets', 'assets')]);
		expect(env).toEqual({
			AWS_ENDPOINT_URL: 'http://localhost:52700',
			AWS_REGION: 'us-east-1',
			AWS_ACCESS_KEY_ID: accessKeyFor('a'),
			AWS_SECRET_ACCESS_KEY: 'glass-garden',
			ASSETS_BUCKET: 'assets',
			S3_BUCKET: 'assets'
		});
	});

	it('drops the conventional name when more than one bucket is connected', () => {
		const env = awsEnv(consumer, [
			bucket('b1', 'Assets', 'assets'),
			bucket('b2', 'Backups', 'backups')
		]);
		expect(env.ASSETS_BUCKET).toBe('assets');
		expect(env.BACKUPS_BUCKET).toBe('backups');
		expect(env.S3_BUCKET).toBeUndefined();
	});

	it('disambiguates two buckets whose names slug the same', () => {
		const env = awsEnv(consumer, [bucket('b1', 'My Data', 'one'), bucket('b2', 'My  Data', 'two')]);
		expect(env.MY_DATA_BUCKET).toBe('one');
		expect(env.MY_DATA_BUCKET_2).toBe('two');
	});
});
