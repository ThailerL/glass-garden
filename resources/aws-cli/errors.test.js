import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportError, UsageError } from './errors.js';

function capture(error) {
	const written = [];
	const write = vi.spyOn(process.stderr, 'write').mockImplementation((text) => {
		written.push(text);
		return true;
	});
	const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
	reportError(error);
	const code = exit.mock.calls[0][0];
	write.mockRestore();
	exit.mockRestore();
	return { text: written.join(''), code };
}

afterEach(() => vi.restoreAllMocks());

describe('reportError', () => {
	it('prints the usage text and exits 2 on a usage error', () => {
		const { text, code } = capture(new UsageError('no service given'));
		expect(text).toContain('aws: no service given');
		expect(text).toContain('usage: aws <service> <operation>');
		expect(code).toBe(2);
	});

	it('keeps an SDK error name and message, and exits 1', () => {
		const denial = Object.assign(new Error('Draw an edge to grant access to bucket notes'), {
			name: 'AccessDenied'
		});
		const { text, code } = capture(denial);
		expect(text).toBe('aws: AccessDenied: Draw an edge to grant access to bucket notes\n');
		expect(code).toBe(1);
	});

	it('omits a bare Error name', () => {
		expect(capture(new Error('connect ECONNREFUSED')).text).toBe('aws: connect ECONNREFUSED\n');
	});

	it('unwraps an AggregateError to its first cause', () => {
		const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:52700'), {
			name: 'Error'
		});
		const { text } = capture(new AggregateError([refused], ''));
		expect(text).toBe('aws: connect ECONNREFUSED 127.0.0.1:52700\n');
	});
});

describe('the reference link', () => {
	it('is appended for a usage error carrying a service', () => {
		const { text } = capture(new UsageError('no operation given for "sqs"', 'sqs'));
		expect(text).toContain('aws: no operation given for "sqs"');
		expect(text).toContain('https://docs.aws.amazon.com/cli/latest/reference/sqs/');
	});

	it('is omitted when the error carries none', () => {
		expect(capture(new UsageError('no service given')).text).not.toContain('docs.aws.amazon.com');
	});
});
