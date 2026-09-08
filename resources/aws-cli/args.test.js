import { describe, expect, it } from 'vitest';
import { kebabCase, parseArgs, parseValue, pascalCase } from './args.js';
import { UsageError } from './errors.js';

describe('pascalCase', () => {
	it('spells an SDK input key from a CLI flag', () => {
		expect(pascalCase('queue-url')).toBe('QueueUrl');
		expect(pascalCase('max-number-of-messages')).toBe('MaxNumberOfMessages');
		expect(pascalCase('bucket')).toBe('Bucket');
	});

	it('leaves an already-capitalised segment alone', () => {
		expect(pascalCase('cli-input-json')).toBe('CliInputJson');
	});
});

describe('kebabCase', () => {
	it('names an SDK operation back the way it was typed', () => {
		expect(kebabCase('SendMessage')).toBe('send-message');
		expect(kebabCase('ListObjectsV2')).toBe('list-objects-v2');
	});
});

describe('parseValue', () => {
	it('keeps a bare word a string', () => {
		expect(parseValue('Bucket', 'notes')).toBe('notes');
		expect(parseValue('Bucket', '3things')).toBe('3things');
	});

	it('parses a structured value', () => {
		expect(parseValue('Item', '{"id": {"S": "1"}}')).toEqual({ id: { S: '1' } });
		expect(parseValue('MaxKeys', '5')).toBe(5);
		expect(parseValue('Flag', 'true')).toBe(true);
	});

	it('keeps a JSON message body a string', () => {
		expect(parseValue('MessageBody', '{"userId": 1}')).toBe('{"userId": 1}');
		expect(parseValue('Body', '[1,2]')).toBe('[1,2]');
	});
});

const thrownBy = (argv) => {
	try {
		parseArgs(argv);
	} catch (error) {
		return error;
	}
	throw new Error(`${argv.join(' ')} did not throw`);
};

describe('parseArgs', () => {
	it('reads a service, an operation and its flags', () => {
		expect(parseArgs(['sqs', 'send-message', '--queue-url', 'http://q/1'])).toEqual({
			service: 'sqs',
			operation: 'SendMessage',
			params: { QueueUrl: 'http://q/1' }
		});
	});

	it('treats a flag with no value as a boolean', () => {
		const { params } = parseArgs(['dynamodb', 'scan', '--consistent-read', '--table-name', 't']);
		expect(params).toEqual({ ConsistentRead: true, TableName: 't' });
	});

	it('merges --cli-input-json, with explicit flags winning either side of it', () => {
		const { params } = parseArgs([
			'sqs',
			'send-message',
			'--cli-input-json',
			'{"QueueUrl": "from-doc", "DelaySeconds": 5}',
			'--queue-url',
			'from-flag'
		]);
		expect(params).toEqual({ QueueUrl: 'from-flag', DelaySeconds: 5 });
	});

	// reportError renders the link; parseArgs owes it the service
	it('carries the service on errors about a known one', () => {
		expect(() => parseArgs(['sqs'])).toThrow(/no operation given for "sqs"/);
		expect(thrownBy(['sqs']).service).toBe('sqs');
		expect(thrownBy(['sqs', 'send-message', 'stray']).service).toBe('sqs');
		expect(thrownBy(['sqs', 'send-message', '--cli-input-json', '{']).service).toBe('sqs');
	});

	it('names an unknown service, carrying none', () => {
		expect(() => parseArgs(['bogus'])).toThrow(/unknown service "bogus"/);
		expect(thrownBy(['bogus']).service).toBeUndefined();
		expect(thrownBy([]).service).toBeUndefined();
	});
});
