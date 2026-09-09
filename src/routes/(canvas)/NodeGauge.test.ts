import { describe, expect, it } from 'vitest';
import { slots } from './NodeGauge.svelte';

const level = (value: number, capacity?: number) => ({ value, capacity, peak: value });

describe('slots', () => {
	it('draws one slot per unit of capacity, lit by the value', () => {
		expect(slots(level(3, 4))).toEqual({ count: 4, lit: 3 });
		expect(slots(level(0, 4))).toEqual({ count: 4, lit: 0 });
		expect(slots(level(1, 1))).toEqual({ count: 1, lit: 1 });
	});

	it('stays smooth without a capacity, where the full mark is only the session peak', () => {
		expect(slots(level(3))).toBeUndefined();
	});

	it('stays smooth past the count that still reads as slots', () => {
		expect(slots(level(6, 16))).toEqual({ count: 16, lit: 6 });
		expect(slots(level(6, 17))).toBeUndefined();
	});

	it('stays smooth for a capacity that is not a whole number of slots', () => {
		expect(slots(level(1, 0))).toBeUndefined();
		expect(slots(level(1, 2.5))).toBeUndefined();
	});

	it('keeps the lit count inside the slots it has', () => {
		expect(slots(level(9, 4))).toEqual({ count: 4, lit: 4 });
		expect(slots(level(-1, 4))).toEqual({ count: 4, lit: 0 });
	});
});
