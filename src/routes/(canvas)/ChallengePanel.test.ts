import { describe, expect, it, vi } from 'vitest';
import { challengeSchema, windowsOf } from '$lib/challenge';
import {
	eventSentence,
	offersHint,
	shadedSpans,
	stateNote,
	timelineRows
} from './ChallengePanel.svelte';

// The functions under test need neither the project store nor the embed module, both of which
// read the browser as they load
vi.mock('$lib/projects.svelte', () => ({}));
vi.mock('$lib/embed', () => ({}));

const errorRate = (lte: number, from: number, to?: number) => ({
	metric: {
		node: { name: 'Traffic' },
		name: 'errors',
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
			conditions: [{ node: { ref: { name: 'App A' } } }, errorRate(0.1, 22, 35)]
		}
	]
});
const goal = (id: string) => challenge.goals.find((g) => g.id === id)!;

describe('timelineRows', () => {
	it('puts events and goals in one run order, events first within a second', () => {
		expect(
			timelineRows(challenge).map((row) => [row.time, row.event ? 'event' : row.goal.id])
		).toEqual([
			['0 s', 'event'],
			// Not "0 s": the canvas check reads the canvas the clock started on
			['At start', 'wired'],
			['At start, 22–35 s', 'both'],
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
				{ id: 'a', title: 'A', conditions: [{ node: { ref: { name: 'App A' } } }] },
				{ id: 'b', title: 'B', conditions: [{ node: { ref: { name: 'App B' } } }] },
				{ id: 'c', title: 'C', conditions: [errorRate(0, 20, 30)] }
			]
		});
		expect(
			timelineRows(shared).map((row) => [row.time, row.event ? 'event' : row.goal.id])
		).toEqual([
			['At start', 'a'],
			['', 'b'],
			['20 s', 'event'],
			['', 'event'],
			// A span starting the same second is not the same label, so it keeps its own
			['20–30 s', 'c']
		]);
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

describe('offersHint', () => {
	const hinted = { ...goal('outage'), hint: 'The balancer needs somewhere else to send requests' };

	it('offers a hint only once a scored run has failed the goal', () => {
		expect(offersHint(hinted, 'failed', 'done')).toBe(true);
		expect(offersHint(hinted, 'failed', 'running')).toBe(false);
		expect(offersHint(hinted, 'met', 'done')).toBe(false);
		// A run that was stopped or crashed is not scored, so nothing is given away
		expect(offersHint(hinted, 'failed', 'ended')).toBe(false);
	});

	it('offers nothing for a goal written without one', () => {
		expect(offersHint(goal('outage'), 'failed', 'done')).toBe(false);
	});
});

describe('stateNote', () => {
	it('says only what the mark cannot: the second a goal broke', () => {
		expect(stateNote('failed', 28)).toBe('Failed at 28 s');
		expect(stateNote('waiting', undefined)).toBe('');
		expect(stateNote('judging', undefined)).toBe('');
		expect(stateNote('met', undefined)).toBe('');
		expect(stateNote('failed', undefined)).toBe('');
	});
});
