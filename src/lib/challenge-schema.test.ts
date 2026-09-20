import { describe, it, expect } from 'vitest';
import { challengeJsonSchema } from '$lib/project-document';

// Its own file, and mocking nothing: generated beside a test that stands in a fake resource
// set, the shipped schema would offer an editor resource types the app does not have
describe('challengeJsonSchema', () => {
	it('lists the resource types the app actually ships', () => {
		const types = JSON.stringify(challengeJsonSchema());
		expect(types).toContain('requestGenerator');
		expect(types).toContain('instanceGroup');
	});

	// The file an editor checks a hand-written challenge against, generated rather than kept by
	// hand. Regenerate it with `npm test -- -u` after changing the format
	it('matches the schema shipped beside the challenges', async () => {
		await expect(JSON.stringify(challengeJsonSchema(), null, '\t') + '\n').toMatchFileSnapshot(
			'../../static/challenges/schema.json'
		);
	});
});
