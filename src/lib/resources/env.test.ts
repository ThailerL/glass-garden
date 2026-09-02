import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/svelte';
import { consumerEnv, withheldConventionalNames } from './env';
import { accessKeyFor } from '$lib/aws-topology';

const node = (id: string, type: string, config: Record<string, unknown>): Node =>
	({ id, type, position: { x: 0, y: 0 }, data: { config } }) as unknown as Node;

const app = (id: string, name: string) =>
	node(id, 'instanceGroup', { name, instanceCount: 1, command: 'npm start' });
const bucket = (id: string, name: string, bucketName: string) =>
	node(id, 's3Bucket', { name, bucketName });
const database = (id: string, name: string) => node(id, 'postgres', { name, maxConnections: 10 });

const upstream = (target: Node, port = 5000) => ({
	node: target,
	instances: [],
	reservedPorts: [port]
});

describe('consumerEnv', () => {
	const web = app('a', 'Web');

	it('supplies AWS credentials with nothing connected, so code can still reach CloudWatch', () => {
		expect(consumerEnv(web, [])).toEqual({
			AWS_ENDPOINT_URL: 'http://localhost:52700',
			AWS_REGION: 'us-east-1',
			AWS_ACCESS_KEY_ID: accessKeyFor('a'),
			AWS_SECRET_ACCESS_KEY: 'glass-garden'
		});
	});

	it('takes the named and conventional variables from what each provider supplies', () => {
		const env = consumerEnv(web, [upstream(bucket('b1', 'Assets', 'assets'))]);
		expect(env.ASSETS_BUCKET).toBe('assets');
		expect(env.S3_BUCKET).toBe('assets');
	});

	it('names a database the same way, from the provider rather than the consumer', () => {
		const env = consumerEnv(web, [upstream(database('p1', 'Orders'), 5433)]);
		expect(env.ORDERS_DATABASE_URL).toContain('5433');
		expect(env.DATABASE_URL).toBe(env.ORDERS_DATABASE_URL);
	});

	it('mixes providers of different kinds in one environment', () => {
		const env = consumerEnv(web, [
			upstream(bucket('b1', 'Assets', 'assets')),
			upstream(database('p1', 'Orders'), 5433)
		]);
		expect(env.S3_BUCKET).toBe('assets');
		expect(env.DATABASE_URL).toBeDefined();
		expect(env.AWS_ACCESS_KEY_ID).toBe(accessKeyFor('a'));
	});

	it('drops the conventional name when two of a kind are connected', () => {
		const env = consumerEnv(web, [
			upstream(bucket('b1', 'Assets', 'assets')),
			upstream(bucket('b2', 'Backups', 'backups'))
		]);
		expect(env.ASSETS_BUCKET).toBe('assets');
		expect(env.BACKUPS_BUCKET).toBe('backups');
		expect(env.S3_BUCKET).toBeUndefined();
	});

	it('disambiguates two providers whose names slug the same', () => {
		const env = consumerEnv(web, [
			upstream(bucket('b1', 'My Data', 'one')),
			upstream(bucket('b2', 'My  Data', 'two'))
		]);
		// Which one takes the bare name follows the sort, which is not worth pinning here
		expect([env.MY_DATA_BUCKET, env.MY_DATA_BUCKET_2].sort()).toEqual(['one', 'two']);
	});

	it('gives no credentials to a consumer that cannot call AWS', () => {
		const balancer = node('lb', 'httpLoadBalancer', { name: 'LB', algorithm: 'round-robin' });
		expect(consumerEnv(balancer, [])).toEqual({});
	});

	it('reports the conventional name it withheld, so it never just vanishes', () => {
		const two = [
			upstream(bucket('b1', 'Assets', 'assets')),
			upstream(bucket('b2', 'Backups', 'backups'))
		];
		expect(withheldConventionalNames(two)).toEqual(['S3_BUCKET']);
		expect(consumerEnv(web, two).S3_BUCKET).toBeUndefined();
	});

	it('withholds nothing when each kind is connected once', () => {
		const mixed = [upstream(bucket('b1', 'Assets', 'assets')), upstream(database('p1', 'Orders'))];
		expect(withheldConventionalNames(mixed)).toEqual([]);
	});
});
