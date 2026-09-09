import { describe, expect, it } from 'vitest';
import {
	bucketFromPath,
	decideRequest,
	denialResponse,
	emptyTopology,
	extractResourceNames,
	invokedFunctionName,
	parseCredential,
	isNotificationQueue,
	notifiedBuckets,
	receivedMessages,
	type Topology
} from '../../resources/aws-region/lib.js';

const auth = (service: string, accessKeyId = 'ggweb') =>
	`AWS4-HMAC-SHA256 Credential=${accessKeyId}/20260901/us-east-1/${service}/aws4_request, ` +
	'SignedHeaders=host;x-amz-date, Signature=abc123';

const topology: Topology = {
	principals: {
		ggweb: {
			nodeId: 'node-1',
			name: 'Web App',
			resources: { s3: ['assets'], sqs: ['jobs'], dynamodb: [], lambda: ['resize'] }
		},
		// The admin holds everything on the canvas and belongs to no node
		ggadmin: {
			name: 'Admin',
			resources: { s3: ['assets'], sqs: ['jobs'], dynamodb: [], lambda: ['resize'] }
		}
	},
	owners: {
		s3: { assets: 'node-2' },
		sqs: { jobs: 'node-3' },
		dynamodb: {},
		lambda: { resize: 'node-4' }
	},
	ports: { 'node-4': 4100 }
};

describe('parseCredential', () => {
	it('reads the access key, region and service from the credential scope', () => {
		expect(parseCredential(auth('s3'))).toEqual({
			accessKeyId: 'ggweb',
			region: 'us-east-1',
			service: 's3'
		});
	});

	it('rejects missing and malformed headers', () => {
		expect(parseCredential(undefined)).toBeUndefined();
		expect(parseCredential('Basic dXNlcjpwYXNz')).toBeUndefined();
		expect(parseCredential('AWS4-HMAC-SHA256 Credential=broken')).toBeUndefined();
	});
});

describe('extractResourceNames', () => {
	it('takes the bucket from a path-style S3 path', () => {
		expect(bucketFromPath('/assets/some/key.txt')).toBe('assets');
		expect(extractResourceNames('s3', '/assets?list-type=2', undefined)).toEqual(['assets']);
		expect(extractResourceNames('s3', '/', undefined)).toEqual([]);
	});

	// A copy is addressed to its destination and names its source in a header; S3 requires
	// access to both, so both are enforced
	it('adds the source bucket of an S3 copy', () => {
		const copy = (source: string) =>
			extractResourceNames('s3', '/backup/key.txt', undefined, { 'x-amz-copy-source': source });
		expect(copy('assets/some/key.txt')).toEqual(['backup', 'assets']);
		expect(copy('/assets/some/key.txt?versionId=3')).toEqual(['backup', 'assets']);
	});

	it('reads TableName from DynamoDB bodies', () => {
		expect(extractResourceNames('dynamodb', '/', '{"TableName":"users"}')).toEqual(['users']);
	});

	it('reads the queue name from QueueUrl or QueueName', () => {
		const url = 'http://sqs.us-east-1.amazonaws.com/123456789012/jobs';
		expect(extractResourceNames('sqs', '/', JSON.stringify({ QueueUrl: url }))).toEqual(['jobs']);
		expect(extractResourceNames('sqs', '/', '{"QueueName":"jobs"}')).toEqual(['jobs']);
	});

	it('reads every table a DynamoDB batch or transaction names', () => {
		const batchGet = { RequestItems: { users: { Keys: [] }, orders: { Keys: [] } } };
		expect(extractResourceNames('dynamodb', '/', JSON.stringify(batchGet))).toEqual([
			'users',
			'orders'
		]);
		const transact = {
			TransactItems: [
				{ Put: { TableName: 'users', Item: {} } },
				{ Delete: { TableName: 'orders', Key: {} } }
			]
		};
		expect(extractResourceNames('dynamodb', '/', JSON.stringify(transact))).toEqual([
			'users',
			'orders'
		]);
	});

	it('keeps the addressed table first and names each table once', () => {
		const body = { TableName: 'users', TransactItems: [{ Put: { TableName: 'orders' } }] };
		expect(extractResourceNames('dynamodb', '/', JSON.stringify(body))).toEqual([
			'users',
			'orders'
		]);
		const repeated = { RequestItems: { users: {}, orders: {} }, TableName: 'users' };
		expect(extractResourceNames('dynamodb', '/', JSON.stringify(repeated))).toEqual([
			'users',
			'orders'
		]);
	});

	// An item attribute is always a typed map, never a bare string
	it('ignores an item attribute called TableName', () => {
		const body = { TableName: 'users', Item: { TableName: { S: 'orders' } } };
		expect(extractResourceNames('dynamodb', '/', JSON.stringify(body))).toEqual(['users']);
	});

	it('reads the dead letter queue out of a redrive policy', () => {
		const body = {
			QueueUrl: 'http://sqs.us-east-1.amazonaws.com/123456789012/jobs',
			Attributes: {
				RedrivePolicy: JSON.stringify({
					deadLetterTargetArn: 'arn:aws:sqs:us-east-1:123456789012:failed',
					maxReceiveCount: 3
				})
			}
		};
		expect(extractResourceNames('sqs', '/', JSON.stringify(body))).toEqual(['jobs', 'failed']);
	});

	it('does not read a queue name out of a message body', () => {
		const body = {
			QueueUrl: 'http://sqs.us-east-1.amazonaws.com/123456789012/jobs',
			MessageBody: JSON.stringify({ QueueUrl: 'secrets', arn: 'arn:aws:sqs:us-east-1:1:secrets' })
		};
		expect(extractResourceNames('sqs', '/', JSON.stringify(body))).toEqual(['jobs']);
	});

	it('reads the function an Invoke names, however the caller wrote it', () => {
		const invoke = (name: string) =>
			`/2015-03-31/functions/${encodeURIComponent(name)}/invocations`;
		expect(invokedFunctionName(invoke('resize'))).toBe('resize');
		expect(
			invokedFunctionName(invoke('arn:aws:lambda:us-east-1:000000000000:function:resize'))
		).toBe('resize');
		expect(invokedFunctionName(invoke('000000000000:function:resize'))).toBe('resize');
		expect(invokedFunctionName('/2015-03-31/functions/')).toBeUndefined();
		expect(extractResourceNames('lambda', '/2015-03-31/functions/', undefined)).toEqual([]);
	});

	it('names nothing on unparseable or nameless bodies', () => {
		expect(extractResourceNames('sqs', '/', 'not json')).toEqual([]);
		expect(extractResourceNames('dynamodb', '/', '{}')).toEqual([]);
		expect(extractResourceNames('rds', '/', '{}')).toEqual([]);
	});
});

describe('decideRequest', () => {
	const decide = (authorization: string | undefined, ...resourceNames: string[]) =>
		decideRequest({ credential: parseCredential(authorization), resourceNames }, topology);

	it('allows a connected resource', () => {
		const decision = decide(auth('s3'), 'assets');
		expect(decision.allow).toBe(true);
	});

	it('allows nameless list operations once the service is connected', () => {
		expect(decide(auth('s3')).allow).toBe(true);
	});

	it('denies requests without credentials', () => {
		const decision = decideRequest({ credential: undefined, resourceNames: [] }, topology);
		expect(decision).toMatchObject({ allow: false, status: 403, code: 'AccessDenied' });
	});

	it('denies services outside the family', () => {
		expect(decide(auth('rds'))).toMatchObject({ allow: false, code: 'UnsupportedService' });
	});

	it('denies unknown access keys', () => {
		expect(decide(auth('s3', 'stranger'))).toMatchObject({
			allow: false,
			code: 'InvalidAccessKeyId'
		});
	});

	it('denies a service with no node on the canvas, naming the caller', () => {
		const decision = decide(auth('dynamodb'), 'users');
		expect(decision).toMatchObject({ allow: false, nodeId: 'node-1' });
		expect(decision.allow || decision.message).toContain('Web App');
	});

	it('denies a service the caller has no edge to', () => {
		const withoutSqsEdge: Topology = {
			principals: {
				ggweb: {
					nodeId: 'node-1',
					name: 'Web App',
					resources: { s3: ['assets'], sqs: [], dynamodb: [], lambda: [] }
				}
			},
			owners: { ...emptyTopology().owners, s3: { assets: 'node-2' }, sqs: { jobs: 'node-3' } },
			ports: {}
		};
		const decision = decideRequest(
			{ credential: parseCredential(auth('sqs')), resourceNames: ['jobs'] },
			withoutSqsEdge
		);
		expect(decision).toMatchObject({ allow: false, nodeId: 'node-1' });
	});

	it('denies a named resource the caller is not connected to', () => {
		const decision = decide(auth('s3'), 'other-bucket');
		expect(decision).toMatchObject({ allow: false, status: 403, nodeId: 'node-1' });
		expect(decision.allow || decision.message).toContain('other-bucket');
	});

	// The admin cannot draw an edge, so its denials say what is missing from the canvas and
	// carry no nodeId - there is no log to route them to
	it('tells the admin what the canvas lacks, rather than to draw an edge', () => {
		expect(decide(auth('s3', 'ggadmin'), 'assets').allow).toBe(true);

		const noSuchBucket = decide(auth('s3', 'ggadmin'), 'other-bucket');
		expect(noSuchBucket).toMatchObject({ allow: false, status: 403 });
		expect(noSuchBucket.allow || noSuchBucket.message).toMatch(
			/no bucket "other-bucket" on the canvas/
		);
		expect(noSuchBucket.allow || noSuchBucket.nodeId).toBeUndefined();

		const noTables = decide(auth('dynamodb', 'ggadmin'), 'users');
		expect(noTables.allow || noTables.message).toMatch(/no Table node on the canvas/);
	});

	it('treats a function like any other resource: an edge to it, or a signpost', () => {
		expect(decide(auth('lambda'), 'resize').allow).toBe(true);
		const wrong = decide(auth('lambda'), 'other');
		expect(wrong).toMatchObject({ allow: false, status: 403, nodeId: 'node-1' });
		expect(wrong.allow || wrong.message).toMatch(/function "other".*Function node/);
	});

	it('requires every resource a request names: a granted one does not excuse another', () => {
		expect(decide(auth('s3'), 'assets', 'assets').allow).toBe(true);
		expect(decide(auth('s3'), 'assets', 'other-bucket').allow).toBe(false);
	});
});

describe('denialResponse', () => {
	const denial = {
		allow: false,
		status: 403,
		code: 'AccessDenied',
		message: 'not connected to "x" & <y>'
	} as const;

	it('speaks XML for S3 with escaped text', () => {
		const response = denialResponse('s3', denial);
		expect(response.contentType).toBe('application/xml');
		expect(response.body).toContain('<Code>AccessDenied</Code>');
		expect(response.body).not.toContain('<y>');
	});

	it('speaks the JSON protocol for the others', () => {
		const response = denialResponse('sqs', denial);
		expect(response.contentType).toBe('application/x-amz-json-1.0');
		expect(JSON.parse(response.body)).toEqual({
			__type: 'AccessDenied',
			message: 'not connected to "x" & <y>'
		});
	});
});

describe('receivedMessages', () => {
	it('reads the messages a receive returned, and an empty or broken answer as none', () => {
		expect(receivedMessages('{"Messages":[{"MessageId":"a"},{"MessageId":"b"}]}')).toHaveLength(2);
		expect(receivedMessages('{}')).toEqual([]);
		expect(receivedMessages('not json')).toEqual([]);
	});
});

describe('notifiedBuckets', () => {
	const notification = (bucket: string) =>
		JSON.stringify({ Records: [{ s3: { bucket: { name: bucket }, object: { key: 'k' } } }] });

	it('names the bucket behind each notification and skips what is not one', () => {
		const messages = [
			{ Body: notification('uploads') },
			{ Body: JSON.stringify({ Service: 'Amazon S3', Event: 's3:TestEvent' }) },
			{ Body: 'not json' },
			{ Body: notification('archive') }
		];
		expect(notifiedBuckets(messages)).toEqual(['uploads', 'archive']);
		expect(isNotificationQueue('gg-notifications-abc')).toBe(true);
		expect(isNotificationQueue('jobs')).toBe(false);
	});
});
