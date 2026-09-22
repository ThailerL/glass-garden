import { describe, expect, it } from 'vitest';
import { challengeSchema } from '$lib/challenge';
import {
	eventSentence,
	goalsInOrder,
	shadedSpans,
	timelineRows,
	windowsOf
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
		{
			id: 'both',
			title: 'Both',
			conditions: [{ exists: { node: { name: 'App A' } } }, errorRate(0.1, 22, 35)]
		}
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
			['At the start, 22–35 s', 'both'],
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

	it('labels a goal by the union of its windows, once', () => {
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
			['5–10 s, 20–30 s', 'apart'],
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

describe('windowsOf and shadedSpans', () => {
	it('reads a canvas check as the start and a window as its stretch', () => {
		expect(windowsOf(goal('both'), 55)).toEqual({ atStart: true, judged: [[22, 35]] });
		expect(windowsOf(goal('after'), 55)).toEqual({ atStart: false, judged: [[40, 55]] });
	});

	it('shades each judged stretch once', () => {
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
