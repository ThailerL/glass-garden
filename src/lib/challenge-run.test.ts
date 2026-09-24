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
						metricName: 'errors',
						statistic: 'Average',
						from: 5,
						lte: 0.1
					}
				}
			]
		}
	]
});

function fakeCanvas(clearFails = false, readHangs = false) {
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
	let settled = true;
	const calls: string[] = [];
	const services: RunServices = {
		canvas: () => canvas,
		statuses: () => statuses,
		metrics: () => ({}),
		startsLast: (type) => type === 'requestGenerator',
		settled: () => settled,
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
		clearStoredData: async () => {
			calls.push('clearStoredData');
			return clearFails ? { nodeId: 'app', nodeName: 'App' } : undefined;
		},
		read: async (id, read) => {
			calls.push(`read ${read} ${id}`);
			if (readHangs) await new Promise(() => {});
			return undefined;
		},
		finished: vi.fn(),
		unscored: vi.fn()
	};
	return {
		services,
		calls,
		setStatuses: (next: Record<string, ResourceStatus>) => (statuses = next),
		setSettled: (next: boolean) => (settled = next),
		edit: (next: CanvasView) => (canvas = next),
		canvas: () => canvas
	};
}

// Seconds of run clock, ticked through rather than jumped so every tick's work happens
const advance = (seconds: number) => vi.advanceTimersByTime(seconds * 1000);

// A run started with every node up, one tick in, so its clock has just begun
async function running() {
	const fake = fakeCanvas();
	const run = new ChallengeRun(challenge, fake.services);
	await run.start();
	fake.setStatuses({ gen: 'running', app: 'running' });
	advance(TICK_MS / 1000);
	return { fake, run };
}

describe('ChallengeRun', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('starts the traffic last, and holds the clock until every node is running', async () => {
		const fake = fakeCanvas();
		const run = new ChallengeRun(challenge, fake.services);
		await run.start();
		expect(fake.calls).toEqual(['stopAll', 'clearStoredData', 'start app']);
		// Locked from the press, not from the clock: a boot is part of the run
		expect(run.active).toBe(true);
		advance(30);
		expect(run.phase).toBe('starting');
		expect(run.elapsed).toBe(0);

		fake.setStatuses({ gen: 'stopped', app: 'running' });
		advance(TICK_MS / 1000);
		expect(fake.calls.at(-1)).toBe('start gen');
		expect(run.phase).toBe('starting');

		fake.setStatuses({ gen: 'running', app: 'running' });
		advance(TICK_MS / 1000);
		expect(run.phase).toBe('running');
		expect(fake.calls.filter((call) => call === 'start gen')).toHaveLength(1);
		expect(fake.calls).toContain('set gen {"requestsPerSecond":5}');
		run.dispose();
	});

	it('holds the traffic back until the orchestrator is settled', async () => {
		const fake = fakeCanvas();
		const run = new ChallengeRun(challenge, fake.services);
		await run.start();
		fake.setSettled(false);
		fake.setStatuses({ gen: 'stopped', app: 'running' });
		advance(5);
		expect(fake.calls).not.toContain('start gen');

		fake.setSettled(true);
		advance(TICK_MS / 1000);
		expect(fake.calls.at(-1)).toBe('start gen');
		run.dispose();
	});

	it('plays the script in time order and scores the run at its end', async () => {
		const { fake, run } = await running();

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
		expect(fake.services.finished).toHaveBeenCalledWith({ met: ['wired'], failed: ['calm'] });
		expect(fake.calls).toContain('stopAll');

		await run.start();
		expect(run.failedAt).toEqual({});
		run.dispose();
	});

	// Its row already says "At the start", and Math.floor(0) would have the panel say "0 s"
	it('records no second for a goal the canvas answers', async () => {
		const fake = fakeCanvas();
		fake.edit({ nodes: fake.canvas().nodes, edges: [] });
		const run = new ChallengeRun(challenge, fake.services);
		await run.start();
		fake.setStatuses({ gen: 'running', app: 'running' });
		advance(10);
		expect(run.goals.wired).toBe('failed');
		expect(run.failedAt).not.toHaveProperty('wired');
		run.dispose();
	});

	it('judges the canvas the clock started on, and the settings its own events change', async () => {
		const { fake, run } = await running();
		advance(1);
		// The reader's edit does not reach the goals: the run began before it
		fake.edit({ ...fake.canvas(), edges: [] });
		advance(3);
		expect(run.phase).toBe('running');
		expect(run.goals.wired).toBe('met');
		expect(fake.calls).toContain('set gen {"requestsPerSecond":5}');
	});

	it('gives up before the clock when a resource cannot be cleared, naming it', async () => {
		const fake = fakeCanvas(true);
		const run = new ChallengeRun(challenge, fake.services);
		await run.start();
		expect(run.phase).toBe('ended');
		expect(run.ended).toEqual({ reason: 'not-cleared', nodeId: 'app', nodeName: 'App' });
		// Nothing came up, so there is no half-started canvas judging itself
		expect(fake.calls).toEqual(['stopAll', 'clearStoredData']);
		advance(30);
		expect(run.phase).toBe('ended');
		expect(fake.services.finished).not.toHaveBeenCalled();
	});

	it('gives up when a node fails to start, naming it', async () => {
		const fake = fakeCanvas();
		const run = new ChallengeRun(challenge, fake.services);
		await run.start();
		fake.setStatuses({ gen: 'running', app: 'crashed' });
		advance(TICK_MS / 1000);
		expect(run.phase).toBe('ended');
		// A reason, not a sentence: the id navigates to the node and the name is what is shown
		expect(run.ended).toEqual({ reason: 'did-not-start', nodeId: 'app', nodeName: 'App' });
		expect(fake.services.unscored).toHaveBeenCalledWith(run.ended);
		expect(fake.services.finished).not.toHaveBeenCalled();
		// Nothing is cleared away: the node that crashed is the thing the reader has to look at,
		// so the only stop is the one that prepared the run
		expect(fake.calls.filter((call) => call === 'stopAll')).toHaveLength(1);
	});

	// A read with no `at` is taken at the run's own end, so the clock running out is not the
	// same as the run being knowable
	const storedAtTheEnd = challengeSchema.parse({
		length: 10,
		goals: [
			{
				id: 'g',
				title: 'Stored',
				conditions: [{ data: { node: { name: 'App' }, read: 'item', args: { key: 'k' } } }]
			}
		]
	});

	async function readAtTheEnd(readHangs: boolean) {
		const fake = fakeCanvas(false, readHangs);
		const run = new ChallengeRun(storedAtTheEnd, fake.services);
		await run.start();
		fake.setStatuses({ gen: 'running', app: 'running' });
		advance(TICK_MS / 1000);
		advance(10);
		expect(fake.calls).toContain('read item app');
		return { fake, run };
	}

	it('waits for a read taken at its end before scoring', async () => {
		const { fake, run } = await readAtTheEnd(true);
		advance(30);
		expect(run.phase).toBe('running');
		expect(fake.services.finished).not.toHaveBeenCalled();
		run.dispose();
	});

	it('scores once that read has answered, finding nothing being an answer', async () => {
		const { fake, run } = await readAtTheEnd(false);
		await Promise.resolve();
		advance(TICK_MS / 1000);
		expect(run.phase).toBe('done');
		expect(fake.services.finished).toHaveBeenCalledWith({ met: [], failed: ['g'] });
		run.dispose();
	});

	it('stops on request by undoing Run, and a new start begins from nothing', async () => {
		const { fake, run } = await running();
		advance(5);
		run.stop();
		expect(fake.calls.at(-1)).toBe('stopAll');
		expect(run.ended).toEqual({ reason: 'stopped' });
		const stoppedAt = run.elapsed;
		expect(run.phase).toBe('ended');
		advance(20);
		expect(run.elapsed).toBe(stoppedAt);

		await run.start();
		expect(run.phase).toBe('starting');
		expect(run.elapsed).toBe(0);
		expect(run.goals).toEqual({ wired: 'waiting', calm: 'waiting' });
		advance(TICK_MS / 1000);
		expect(run.phase).toBe('running');
		run.dispose();
	});
});
