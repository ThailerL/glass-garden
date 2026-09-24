import { describe, expect, it } from 'vitest';
import { challengeSchema } from '$lib/challenge';
import {
	eventSentence,
	goalSpan,
	goalsInOrder,
	shadedSpans,
	timelineRows
} from '$lib/challenge-timeline';

const errorRate = (lte: number, from: number, to?: number) => ({
	metric: {
		node: { name: 'Traffic' },
		metricName: 'errors',
		statistic: 'Average' as const,
		lte,
		from,
		...(to === undefined ? {} : { to })
	}
});

const challenge = challengeSchema.parse({
	length: 55,
	events: [
		{ at: 35, start: { name: 'App A' } },
		{
			at: 0,
			text: 'Traffic sends 10 requests a second',
			set: { node: { name: 'Traffic' }, config: {} }
		},
		{ at: 10, stop: { name: 'App A' } }
	],
	goals: [
		{
			id: 'wired',
			title: 'Wired',
			conditions: [{ edge: { from: { name: 'LB' }, to: { name: 'App B' } } }]
		},
		{ id: 'outage', title: 'Outage', conditions: [errorRate(0.05, 22, 35)] },
		{ id: 'after', title: 'After', conditions: [errorRate(0, 40)] },
		{ id: 'present', title: 'Present', conditions: [{ exists: { node: { name: 'App A' } } }] }
	]
});
const goal = (id: string) => challenge.goals.find((one) => one.id === id)!;

describe('timelineRows', () => {
	it('puts events and goals in one run order, events first within a second', () => {
		expect(
			timelineRows(challenge).map((row) => [row.time, row.event ? 'event' : row.goal.id])
		).toEqual([
			['0 s', 'event'],
			// Not "0 s": the canvas check reads the canvas the clock started on
			['At the start', 'wired'],
			// Sharing a label with the row above it, which is why this one is blank
			['', 'present'],
			['10 s', 'event'],
			['22–35 s', 'outage'],
			['35 s', 'event'],
			['40 s–end', 'after']
		]);
	});

	it('labels a time once where rows share it exactly', () => {
		const shared = challengeSchema.parse({
			length: 40,
			events: [
				{ at: 20, stop: { name: 'App A' } },
				{ at: 20, start: { name: 'App A' } }
			],
			goals: [
				{ id: 'a', title: 'A', conditions: [{ exists: { node: { name: 'App A' } } }] },
				{ id: 'b', title: 'B', conditions: [{ exists: { node: { name: 'App B' } } }] },
				{ id: 'c', title: 'C', conditions: [errorRate(0, 20, 30)] }
			]
		});
		expect(
			timelineRows(shared).map((row) => [row.time, row.event ? 'event' : row.goal.id])
		).toEqual([
			['At the start', 'a'],
			['', 'b'],
			['20 s', 'event'],
			['', 'event'],
			// A span starting the same second is not the same label, so it keeps its own
			['20–30 s', 'c']
		]);
	});

	it('labels a goal from its first window to its last, once', () => {
		const read = (key: string) => ({
			data: { node: { name: 'Table' }, read: 'item', args: { key } }
		});
		const overlapping = challengeSchema.parse({
			length: 45,
			goals: [
				{ id: 'reads', title: 'Reads', conditions: [read('a'), read('b'), read('c')] },
				{ id: 'covered', title: 'Covered', conditions: [errorRate(0, 10), errorRate(0, 0)] },
				{ id: 'apart', title: 'Apart', conditions: [errorRate(0, 5, 10), errorRate(0, 20, 30)] }
			]
		});
		expect(timelineRows(overlapping).map((row) => [row.time, row.goal?.id])).toEqual([
			['0 s–end', 'covered'],
			// The gap between the two windows is not something a reader can act on
			['5–30 s', 'apart'],
			['At the end', 'reads']
		]);
	});
});

describe('goalsInOrder', () => {
	it('puts goals that start together in the order they are decided', () => {
		const sharing = challengeSchema.parse({
			length: 30,
			goals: [
				{ id: 'whole', title: 'Whole', conditions: [errorRate(0, 0)] },
				{ id: 'early', title: 'Early', conditions: [errorRate(0, 0, 10)] }
			]
		});
		expect(goalsInOrder(sharing).map((one) => one.id)).toEqual(['early', 'whole']);
	});
});

describe('goalSpan and shadedSpans', () => {
	it('gives a canvas check no span at all, and a window its stretch', () => {
		expect(goalSpan(goal('present'), 55)).toBeUndefined();
		expect(goalSpan(goal('after'), 55)).toEqual([40, 55]);
	});

	it('shades each goal once, over the stretch its row names', () => {
		expect(shadedSpans(challenge)).toEqual([
			[22, 35],
			[40, 55]
		]);
	});
});

describe('eventSentence', () => {
	it("uses the author's sentence, and never a setting's name", () => {
		expect(eventSentence(challenge.events[1])).toBe('Traffic sends 10 requests a second');
		expect(eventSentence(challenge.events[2])).toBe('App A stops');
		expect(
			eventSentence({ at: 5, set: { node: { name: 'Traffic' }, config: { requestsPerSecond: 3 } } })
		).toBe("Traffic's settings change");
	});
});
