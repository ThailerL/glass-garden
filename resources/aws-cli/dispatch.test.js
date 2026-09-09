import { describe, expect, it } from 'vitest';
import { decoded } from './dispatch.js';

describe('decoded', () => {
	it('shows a byte payload as the JSON or text it holds', () => {
		const bytes = (text) => new TextEncoder().encode(text);
		expect(decoded({ StatusCode: 200, Payload: bytes('{"got":1}') })).toEqual({
			StatusCode: 200,
			Payload: { got: 1 }
		});
		expect(decoded({ Payload: bytes('plain') })).toEqual({ Payload: 'plain' });
	});
});
