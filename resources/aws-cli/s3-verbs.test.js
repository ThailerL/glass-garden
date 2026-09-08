import { describe, expect, it } from 'vitest';
import { formatBuckets, formatObjects, parseS3Uri } from './s3-verbs.js';

describe('parseS3Uri', () => {
	it('splits a bucket from a key', () => {
		expect(parseS3Uri('s3://notes/a/b.txt')).toEqual({ Bucket: 'notes', Key: 'a/b.txt' });
		expect(parseS3Uri('s3://notes')).toEqual({ Bucket: 'notes', Key: '' });
		expect(parseS3Uri('s3://notes/')).toEqual({ Bucket: 'notes', Key: '' });
	});

	it('rejects anything that is not an s3 URI', () => {
		expect(parseS3Uri('./local.txt')).toBeUndefined();
		expect(parseS3Uri(undefined)).toBeUndefined();
	});
});

describe('formatting', () => {
	it('lists buckets by creation date', () => {
		expect(formatBuckets([{ Name: 'notes', CreationDate: '2026-09-08T00:01:02.000Z' }])).toEqual([
			'2026-09-08 00:01:02 notes'
		]);
	});

	it('lists prefixes before objects, the way the real CLI does', () => {
		expect(
			formatObjects({
				CommonPrefixes: [{ Prefix: 'a/' }],
				Contents: [{ Key: 'b.txt', Size: 12, LastModified: '2026-09-08T00:01:02.000Z' }]
			})
		).toEqual(['                           PRE a/', '2026-09-08 00:01:02         12 b.txt']);
	});

	it('handles an empty listing', () => {
		expect(formatObjects({})).toEqual([]);
	});
});
