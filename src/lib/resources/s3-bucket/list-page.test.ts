import { describe, expect, it } from 'vitest';
import { listPage } from './index';

const page = (body: string) =>
	`<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${body}</ListBucketResult>`;

describe('listPage', () => {
	it('reads an empty listing as nothing under the prefix', () => {
		expect(listPage(page('<KeyCount>0</KeyCount><IsTruncated>false</IsTruncated>'))).toEqual({
			count: 0
		});
	});

	it('carries the token on to the next page', () => {
		expect(
			listPage(
				page(
					'<KeyCount>1000</KeyCount><IsTruncated>true</IsTruncated><NextContinuationToken>1/abc=</NextContinuationToken>'
				)
			)
		).toEqual({ count: 1000, next: '1/abc=' });
	});

	it('stops on a page that names no token, whatever it claims about more', () => {
		expect(listPage(page('<KeyCount>1000</KeyCount><IsTruncated>true</IsTruncated>'))).toEqual({
			count: 1000,
			next: undefined
		});
	});

	it('refuses an answer that is not a listing', () => {
		expect(() => listPage('<Error><Code>NoSuchBucket</Code></Error>')).toThrow('Not a listing');
	});
});
