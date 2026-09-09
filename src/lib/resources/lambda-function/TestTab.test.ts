import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/svelte';
import { describeOutcome, eventTemplates } from './TestTab.svelte';

const node = (type: string, config: Record<string, unknown>): Node =>
	({ id: 'n1', type, position: { x: 0, y: 0 }, data: { config } }) as unknown as Node;

const queue = node('sqsQueue', { name: 'Jobs', queueName: 'jobs', visibilityTimeout: 30 });
const bucket = node('s3Bucket', { name: 'Uploads', bucketName: 'uploads' });

const template = (sources: Node[], id: string) =>
	eventTemplates(sources, 1_700_000_000_000).find((option) => option.id === id)!.event as {
		Records?: { eventSource: string; eventSourceARN?: string; s3?: { bucket: { name: string } } }[];
		version?: string;
		requestContext?: { http: { method: string }; timeEpoch: number };
	};

describe('eventTemplates', () => {
	it('sends the function URL payload the manager builds', () => {
		const event = template([], 'url');
		expect(event.version).toBe('2.0');
		expect(event.requestContext).toMatchObject({
			http: { method: 'GET' },
			timeEpoch: 1_700_000_000_000
		});
	});

	// index.mjs branches on this field to tell a bucket's records from a queue's
	it('marks each record with the source the shipped handler reads', () => {
		expect(template([], 'queue').Records?.[0].eventSource).toBe('aws:sqs');
		expect(template([], 'object').Records?.[0].eventSource).toBe('aws:s3');
	});

	it('names the queue and bucket pointing at the function', () => {
		expect(template([queue], 'queue').Records?.[0].eventSourceARN).toBe(
			'arn:aws:sqs:us-east-1:000000000000:jobs'
		);
		expect(template([bucket], 'object').Records?.[0].s3?.bucket.name).toBe('uploads');
	});

	it('falls back to a placeholder name when nothing of that kind points at it', () => {
		expect(template([], 'object').Records?.[0].s3?.bucket.name).toBe('my-bucket');
		expect(template([bucket], 'queue').Records?.[0].eventSourceARN).toMatch(/my-queue$/);
	});
});

describe('describeOutcome', () => {
	it('reads a plain 200 as the handler having returned', () => {
		expect(describeOutcome({ status: 200, payload: '{"got":1}' })).toEqual({
			ok: true,
			body: '{\n  "got": 1\n}'
		});
	});

	// Lambda answers 200 for a handler that threw and says so in a header
	it('reads the function error header as a failure, named by what was thrown', () => {
		const outcome = describeOutcome({
			status: 200,
			functionError: 'Unhandled',
			payload: '{"errorType":"TypeError","errorMessage":"boom"}'
		});
		expect(outcome).toMatchObject({ ok: false, detail: 'TypeError: boom' });
	});

	it('shows the region its own words when it refuses', () => {
		const outcome = describeOutcome({
			status: 503,
			payload: '{"__type":"ServiceException","message":"\\"worker\\" is not running."}'
		});
		expect(outcome).toMatchObject({ ok: false, detail: '"worker" is not running.' });
	});

	it('shows a body that is not JSON as it arrived', () => {
		expect(describeOutcome({ status: 500, payload: 'gateway error' })).toMatchObject({
			ok: false,
			detail: undefined,
			body: 'gateway error'
		});
	});
});
