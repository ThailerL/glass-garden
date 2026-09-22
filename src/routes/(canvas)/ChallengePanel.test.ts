import { describe, expect, it, vi } from 'vitest';
import { challengeSchema } from '$lib/challenge';
import { endSentence, offersHint, stateNote } from './ChallengePanel.svelte';

// The panel's instance script reaches the project store, which reads storage as it loads; the
// functions under test need none of it
vi.mock('$lib/projects.svelte', () => ({}));

const challenge = challengeSchema.parse({
	length: 55,
	goals: [
		{
			id: 'outage',
			title: 'Outage',
			conditions: [
				{
					metric: {
						node: { name: 'Traffic' },
						metricName: 'errors',
						statistic: 'Average',
						lte: 0.05,
						from: 22,
						to: 35
					}
				}
			]
		}
	]
});
const goal = (id: string) => challenge.goals.find((one) => one.id === id)!;

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

describe('endSentence', () => {
	it('words each reason the run gives, and says nothing for a run that has not ended', () => {
		expect(endSentence({ reason: 'stopped' })).toBe('Stopped before the end, so it was not scored');
		expect(endSentence({ reason: 'did-not-start', nodeId: 'a', nodeName: 'App A' })).toBe(
			'App A did not start, so the run was not scored'
		);
		expect(endSentence(undefined)).toBe('');
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
