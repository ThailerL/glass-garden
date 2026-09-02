import { describe, expect, it } from 'vitest';
import {
	bucketFromPath,
	decideRequest,
	denialResponse,
	extractResourceName,
	parseCredential,
	type Topology
} from '../../resources/aws-region/lib.mjs';

const auth = (service: string, accessKeyId = 'ggweb') =>
	`AWS4-HMAC-SHA256 Credential=${accessKeyId}/20260901/us-east-1/${service}/aws4_request, ` +
	'SignedHeaders=host;x-amz-date, Signature=abc123';

const topology: Topology = {
	services: ['s3', 'sqs'],
	principals: {
		ggweb: {
			nodeId: 'node-1',
			name: 'Web App',
			resources: { s3: ['assets'], sqs: ['jobs'], dynamodb: [] }
		}
	},
	owners: { s3: { assets: 'node-2' }, sqs: { jobs: 'node-3' }, dynamodb: {} }
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

describe('extractResourceName', () => {
	it('takes the bucket from a path-style S3 path', () => {
		expect(bucketFromPath('/assets/some/key.txt')).toBe('assets');
		expect(extractResourceName('s3', '/assets?list-type=2', undefined)).toBe('assets');
		expect(extractResourceName('s3', '/', undefined)).toBeUndefined();
	});

	it('reads TableName from DynamoDB bodies', () => {
		expect(extractResourceName('dynamodb', '/', '{"TableName":"users"}')).toBe('users');
	});

	it('reads the queue name from QueueUrl or QueueName', () => {
		const url = 'http://sqs.us-east-1.amazonaws.com/123456789012/jobs';
		expect(extractResourceName('sqs', '/', JSON.stringify({ QueueUrl: url }))).toBe('jobs');
		expect(extractResourceName('sqs', '/', '{"QueueName":"jobs"}')).toBe('jobs');
	});

	it('falls back to undefined on unparseable or nameless bodies', () => {
		expect(extractResourceName('sqs', '/', 'not json')).toBeUndefined();
		expect(extractResourceName('dynamodb', '/', '{}')).toBeUndefined();
		expect(extractResourceName('rds', '/', '{}')).toBeUndefined();
	});
});

describe('decideRequest', () => {
	const decide = (authorization: string | undefined, resourceName?: string) =>
		decideRequest({ credential: parseCredential(authorization), resourceName }, topology);

	it('allows a connected resource', () => {
		const decision = decide(auth('s3'), 'assets');
		expect(decision.allow).toBe(true);
	});

	it('allows nameless list operations once the service is connected', () => {
		expect(decide(auth('s3')).allow).toBe(true);
	});

	it('denies requests without credentials', () => {
		const decision = decideRequest({ credential: undefined, resourceName: undefined }, topology);
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
			services: ['s3', 'sqs'],
			principals: {
				ggweb: {
					nodeId: 'node-1',
					name: 'Web App',
					resources: { s3: ['assets'], sqs: [], dynamodb: [] }
				}
			},
			owners: { s3: { assets: 'node-2' }, sqs: { jobs: 'node-3' }, dynamodb: {} }
		};
		const decision = decideRequest(
			{ credential: parseCredential(auth('sqs')), resourceName: 'jobs' },
			withoutSqsEdge
		);
		expect(decision).toMatchObject({ allow: false, nodeId: 'node-1' });
	});

	it('denies a named resource the caller is not connected to', () => {
		const decision = decide(auth('s3'), 'other-bucket');
		expect(decision).toMatchObject({ allow: false, status: 403, nodeId: 'node-1' });
		expect(decision.allow || decision.message).toContain('other-bucket');
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
