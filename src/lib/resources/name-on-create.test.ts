import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/svelte';
import { buildNameValidator } from './name-on-create';

const bucket = (id: string, name: string, bucketName: string): Node =>
	({
		id,
		type: 's3Bucket',
		position: { x: 0, y: 0 },
		data: { config: { name, bucketName } }
	}) as unknown as Node;

describe('buildNameValidator', () => {
	const validate = buildNameValidator('s3Bucket', [bucket('b1', 'Assets', 'assets')]);

	it('accepts a valid, unused pair', () => {
		expect(validate({ name: 'Backups', bucketName: 'backups' })).toEqual({});
	});

	it('maps schema issues to the field that broke, in the schema own words', () => {
		const issues = validate({ name: 'Backups', bucketName: 'NOT_VALID' });
		expect(issues.bucketName).toMatch(/lowercase/i);
		expect(issues.name).toBeUndefined();
	});

	it('refuses a bucket name a bucket on the canvas already uses', () => {
		const issues = validate({ name: 'Other', bucketName: 'assets' });
		expect(issues.bucketName).toContain('already uses');
	});

	it('lets the schema speak before uniqueness, so one field gets one reason', () => {
		const taken = buildNameValidator('s3Bucket', [bucket('b1', 'Assets', 'AB')]);
		const issues = taken({ name: 'Other', bucketName: 'AB' });
		expect(issues.bucketName).toMatch(/lowercase|3/i);
	});

	it('does not count other resource types against uniqueness', () => {
		const app = {
			id: 'a',
			type: 'instanceGroup',
			position: { x: 0, y: 0 },
			data: { config: { name: 'x', instanceCount: 1, command: 'run', bucketName: 'assets' } }
		} as unknown as Node;
		const only = buildNameValidator('s3Bucket', [app]);
		expect(only({ name: 'Assets', bucketName: 'assets' })).toEqual({});
	});
});
