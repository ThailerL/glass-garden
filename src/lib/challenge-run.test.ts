import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChallengeRun, TICK_MS, type RunServices } from '$lib/challenge-run.svelte';
import { challengeSchema, type CanvasView } from '$lib/challenge';
import type { ResourceStatus } from '$lib/resources';

const challenge = challengeSchema.parse({
	length: 10,
	events: [
		{ at: 4, stop: { name: 'App' } },
		{ at: 0, set: { node: { name: 'Traffic' }, config: { requestsPerSecond: 5 } } },
		{ at: 6, start: { name: 'App' } }
	],
	goals: [
		{
			id: 'wired',
			title: 'Wired',
			conditions: [{ edge: { from: { name: 'Traffic' }, to: { name: 'App' } } }]
		},
		{
			id: 'calm',
			title: 'Calm',
			conditions: [
				{
					metric: {
						node: { name: 'Traffic' },
						name: 'errors',
						statistic: 'Average',
						from: 5,
						lte: 0.1
					}
				}
			]
		}
	]
});

function fakeCanvas() {
	let canvas: CanvasView = {
		nodes: [
			{
				id: 'gen',
				type: 'requestGenerator',
				config: { name: 'Traffic', requestsPerSecond: 1 },
				authored: true
			},
			{ id: 'app', type: 'instanceGroup', config: { name: 'App' }, authored: true }
		],
		edges: [{ source: 'gen', target: 'app' }]
	};
	let statuses: Record<string, ResourceStatus> = { gen: 'stopped', app: 'stopped' };
	const calls: string[] = [];
	const services: RunServices = {
		canvas: () => canvas,
		statuses: () => statuses,
		metrics: () => ({}),
		startAll: () => calls.push('startAll'),
		start: (id) => calls.push(`start ${id}`),
		stop: (id) => calls.push(`stop ${id}`),
		setConfig: (id, patch) => {
			calls.push(`set ${id} ${JSON.stringify(patch)}`);
			canvas = {
				...canvas,
				nodes: canvas.nodes.map((n) =>
					n.id === id ? { ...n, config: { ...n.config, ...patch } } : n
				)
			};
		},
		stopAll: () => calls.push('stopAll'),
		finished: vi.fn()
	};
	return {
		services,
		calls,
		setStatuses: (next: Record<string, ResourceStatus>) => (statuses = next),
		edit: (next: CanvasView) => (canvas = next),
		canvas: () => canvas
	};
}

// Seconds of run clock, ticked through rather than jumped so every tick's work happens
const advance = (seconds: number) => vi.advanceTimersByTime(seconds * 1000);

// A run started with every node up, one tick in, so its clock has just begun
function running() {
	const fake = fakeCanvas();
	const run = new ChallengeRun(challenge, fake.services);
	run.start();
	fake.setStatuses({ gen: 'running', app: 'running' });
	advance(TICK_MS / 1000);
	return { fake, run };
}

describe('ChallengeRun', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('starts everything and holds the clock until every node is running', () => {
		const fake = fakeCanvas();
		const run = new ChallengeRun(challenge, fake.services);
		run.start();
		expect(fake.calls).toEqual(['startAll']);
		// Locked from the press, not from the clock: a boot is part of the run
		expect(run.active).toBe(true);
		advance(30);
		expect(run.phase).toBe('starting');
		expect(run.elapsed).toBe(0);

		fake.setStatuses({ gen: 'running', app: 'running' });
		advance(TICK_MS / 1000);
		expect(run.phase).toBe('running');
		expect(fake.calls).toContain('set gen {"requestsPerSecond":5}');
		run.dispose();
	});

	it('plays the script in time order and scores the run at its end', () => {
		const { fake, run } = running();

		advance(4);
		expect(fake.calls.at(-1)).toBe('stop app');
		expect(run.goals).toEqual({ wired: 'met', calm: 'waiting' });
		advance(2);
		expect(fake.calls.at(-1)).toBe('start app');
		expect(run.goals.calm).toBe('judging');

		advance(4);
		expect(run.phase).toBe('done');
		expect(run.elapsed).toBe(10);
		// The generator's store is empty, so the error share has nothing to vouch for it
		expect(run.goals).toEqual({ wired: 'met', calm: 'failed' });
		// The state alone no longer says when, and the panel reports the second it broke
		expect(run.failedAt).toEqual({ calm: 10 });
		expect(fake.services.finished).toHaveBeenCalledWith(['wired']);
		expect(fake.calls).toContain('stopAll');

		run.start();
		expect(run.failedAt).toEqual({});
		run.dispose();
	});

	it('judges the canvas the clock started on, and the settings its own events change', () => {
		const { fake, run } = running();
		advance(1);
		// The reader's edit does not reach the goals: the run began before it
		fake.edit({ ...fake.canvas(), edges: [] });
		advance(3);
		expect(run.phase).toBe('running');
		expect(run.goals.wired).toBe('met');
		expect(fake.calls).toContain('set gen {"requestsPerSecond":5}');
	});

	it('gives up when a node fails to start, naming it', () => {
		const fake = fakeCanvas();
		const run = new ChallengeRun(challenge, fake.services);
		run.start();
		fake.setStatuses({ gen: 'running', app: 'crashed' });
		advance(TICK_MS / 1000);
		expect(run.phase).toBe('ended');
		expect(run.endedBecause).toBe('App did not start, so the run was not scored');
		expect(run.didNotStart).toBe('app');
		// Nothing is cleared away: the node that crashed is the thing the reader has to look at
		expect(fake.calls).not.toContain('stopAll');
	});

	it('stops on request by undoing Run, and a new start begins from nothing', () => {
		const { fake, run } = running();
		advance(5);
		run.stop();
		expect(fake.calls.at(-1)).toBe('stopAll');
		expect(run.endedBecause).toBe('Stopped before the end, so it was not scored');
		const stoppedAt = run.elapsed;
		expect(run.phase).toBe('ended');
		advance(20);
		expect(run.elapsed).toBe(stoppedAt);

		run.start();
		expect(run.phase).toBe('starting');
		expect(run.elapsed).toBe(0);
		expect(run.goals).toEqual({ wired: 'waiting', calm: 'waiting' });
		advance(TICK_MS / 1000);
		expect(run.phase).toBe('running');
		run.dispose();
	});
});
