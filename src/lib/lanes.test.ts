import { describe, expect, it } from 'vitest';
import { fans, LANE_PITCH, lanePath, laneOffsets, MAX_LANES } from '$lib/lanes';

describe('laneOffsets', () => {
	it('centres the lanes on the handle at the dots’ pitch', () => {
		expect(laneOffsets(3)).toEqual([-LANE_PITCH, 0, LANE_PITCH]);
		expect(laneOffsets(2)).toEqual([-LANE_PITCH / 2, LANE_PITCH / 2]);
	});

	it('does not fan a single instance or more than fit the card', () => {
		expect(fans(1)).toBe(false);
		expect(laneOffsets(1)).toEqual([]);
		expect(laneOffsets(MAX_LANES)).toHaveLength(MAX_LANES);
		expect(fans(MAX_LANES + 1)).toBe(false);
		expect(laneOffsets(MAX_LANES + 1)).toEqual([]);
	});
});

describe('lanePath', () => {
	it('curves from the split point to the lane end with level tangents', () => {
		expect(lanePath(60, 50, 100, 62)).toBe('M60,50 C80,50 80,62 100,62');
	});
});
