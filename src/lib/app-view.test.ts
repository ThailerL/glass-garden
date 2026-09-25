import { describe, it, expect } from 'vitest';
import { appView, challengeAddress } from '$lib/app-view';

const at = (address: string) => appView(new URL(address, 'https://glass.garden'));

describe('appView', () => {
	it('reads each view off the query', () => {
		expect(at('/')).toEqual({ name: 'canvas' });
		expect(at('/?challenges')).toEqual({ name: 'challenges' });
		expect(at('/?edit=V1StGXR8')).toEqual({ name: 'edit', nodeId: 'V1StGXR8' });
	});

	it('shows the canvas for a built-in challenge, which names a project rather than a view', () => {
		expect(at('/?challenge=slow-signups')).toEqual({ name: 'canvas' });
	});

	it('shows the canvas for an edit with no node to open', () => {
		expect(at('/?edit=')).toEqual({ name: 'canvas' });
	});
});

describe('challengeAddress', () => {
	it('escapes an id a self-hoster wrote with characters a query cannot hold', () => {
		expect(challengeAddress('a&b c')).toBe('/?challenge=a%26b%20c');
	});
});
