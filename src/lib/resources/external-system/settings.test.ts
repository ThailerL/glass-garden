import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/svelte';
import { externalSystem } from './index';

const system = (settings: Record<string, unknown>) =>
	({
		id: 'bank',
		type: 'externalSystem',
		position: { x: 0, y: 0 },
		data: { config: { name: 'Bank', code: 'export function handle() {}', settings } }
	}) as unknown as Node;

describe('settings', () => {
	it('leaves the launch unchanged, so a new setting does not restart the system', () => {
		expect(externalSystem.launchConfig(system({ down: true }))).toEqual(
			externalSystem.launchConfig(system({}))
		);
	});
});
