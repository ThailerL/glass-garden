import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/svelte';
import { externalSystem } from './index';

const { configSchema } = externalSystem;

const system = (docs: unknown) =>
	({
		id: 'carrier',
		type: 'externalSystem',
		position: { x: 0, y: 0 },
		data: { config: configSchema.parse({ docs }) }
	}) as unknown as Node;

describe('docs', () => {
	it('are empty unless the author writes some', () => {
		expect(configSchema.parse({}).docs).toEqual({ exchanges: [], notes: [] });
	});

	it('take an exchange in either direction, whatever the protocol', () => {
		const { docs } = configSchema.parse({
			docs: {
				exchanges: [
					{ direction: 'you send', signature: 'POST /token', details: ['Answers 200.'] },
					{ direction: 'it sends', signature: 'POST /webhooks/payment' },
					{ direction: 'you send', signature: 'AUTH <key>' }
				],
				notes: ['A token is good for 10 seconds.']
			}
		});
		expect(docs.exchanges.map(({ signature }) => signature)).toEqual([
			'POST /token',
			'POST /webhooks/payment',
			'AUTH <key>'
		]);
		expect(docs.exchanges[1].details).toEqual([]);
	});

	it('refuse a direction that names neither side', () => {
		const exchange = { direction: 'incoming', signature: 'POST /token' };
		expect(configSchema.safeParse({ docs: { exchanges: [exchange] } }).success).toBe(false);
	});

	// A hand-written document, so a misspelt key must not pass as an exchange with no details
	it('refuse a key the format does not have', () => {
		const exchange = { direction: 'you send', signature: 'POST /token', detail: ['Answers 200.'] };
		expect(configSchema.safeParse({ docs: { exchanges: [exchange] } }).success).toBe(false);
	});

	it('leave the launch unchanged, so they never restart the system', () => {
		const written = { exchanges: [{ direction: 'you send', signature: 'POST /token' }] };
		expect(externalSystem.launchConfig(system(written))).toEqual(
			externalSystem.launchConfig(system(undefined))
		);
	});
});
