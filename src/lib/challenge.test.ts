import { describe, it, expect } from 'vitest';
import {
	challengeSchema,
	fixesSetting,
	goalIds,
	judge,
	matches,
	MAX_RUN_SECONDS,
	type CanvasView,
	type Challenge,
	type Condition,
	type ConditionInput,
	type DataCondition,
	type RunRecord
} from '$lib/challenge';
import { dimensionKey, newSeries, record, type Dimensions } from '$lib/metrics';
import type { MetricStore } from '$lib/resource-log.svelte';

const authored = true;
const canvas: CanvasView = {
	nodes: [
		{
			id: 'gen',
			type: 'requestGenerator',
			config: { name: 'Traffic', requestsPerSecond: 10 },
			authored
		},
		{ id: 'lb', type: 'httpLoadBalancer', config: { name: 'LB' }, authored },
		{ id: 'app', type: 'instanceGroup', config: { name: 'App', instanceCount: 2 }, authored },
		{ id: 'queue', type: 'sqsQueue', config: { name: 'Jobs' }, authored },
		{
			id: 'table',
			type: 'dynamodbTable',
			config: { name: 'Accounts', tableName: 'accounts', partitionKey: 'email' },
			authored
		}
	],
	edges: [
		{ source: 'gen', target: 'lb' },
		{ source: 'lb', target: 'app' }
	]
};

function challengeOf(...conditions: ConditionInput[]): Challenge {
	return challengeSchema.parse({ length: 60, goals: [{ id: 'g', title: 'Goal', conditions }] });
}

const STARTED_AT = 1_700_000_000_000;

// The one data condition of a challenge written with exactly one
function readOf(challenge: Challenge): DataCondition {
	const [condition] = challenge.goals[0].conditions;
	if (!('data' in condition)) throw new Error('not a data condition');
	return condition.data;
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
	return {
		length: 60,
		canvas,
		startedAt: STARTED_AT,
		metrics: () => ({}),
		readings: () => undefined,
		...overrides
	};
}

// One node's store, holding a metric recorded at the given seconds of the run
function recorded(
	name: string,
	at: Record<number, number>,
	dimensions: Dimensions = {}
): MetricStore {
	const series = newSeries(STARTED_AT, 'Count', dimensions);
	for (const [second, value] of Object.entries(at)) {
		record(series, STARTED_AT + Number(second) * 1000, value);
	}
	return { [name]: { [dimensionKey(dimensions)]: series } };
}

// A generator's store as it answers requests: a total and the 500s among them, at second 40
function traffic(total: number, failed: number, second = 40): MetricStore {
	return {
		requests: {
			...recorded('requests', { [second]: total }).requests,
			...recorded('requests', { [second]: failed }, { status: '500' }).requests
		}
	};
}

// The same second of traffic as the generator records its outcomes: a 1 for each request that
// failed and a 0 for the rest, so the average over the second is the share that failed
function outcomes(total: number, failed: number, second = 40): MetricStore {
	const series = newSeries(STARTED_AT, 'Count');
	for (let i = 0; i < total; i++) {
		record(series, STARTED_AT + second * 1000, i < failed ? 1 : 0);
	}
	return { errors: { [dimensionKey({})]: series } };
}

// What a goal asking about a generator's failure rate says
const errorRate = (lte: number, window: { from?: number; to?: number } = {}) => ({
	node: { name: 'Traffic' },
	name: 'errors',
	statistic: 'Average' as const,
	over: 'whole window' as const,
	...window,
	lte
});

const stateAt = (challenge: Challenge, r: RunRecord, t: number) => judge(challenge, r, t).g;

describe('challengeSchema', () => {
	it('reads a challenge with events and every kind of condition', () => {
		const parsed = challengeSchema.parse({
			length: 60,
			events: [{ at: 20, stop: { name: 'App' } }],
			goals: [
				{
					id: 'g',
					title: 'All of it',
					conditions: [
						{ node: { name: 'App' }, config: { instanceCount: { gte: 2 } } },
						{ edge: { from: { name: 'LB' }, to: { type: 'instanceGroup' } } },
						{
							metric: {
								node: { name: 'Jobs' },
								name: 'messages',
								statistic: 'Average',
								from: 30,
								lte: 2
							}
						},
						{
							metric: {
								node: { name: 'Traffic' },
								name: 'errors',
								statistic: 'Average',
								from: 20,
								to: 40,
								lte: 0.05
							}
						}
					]
				}
			]
		});
		expect(parsed.goals[0].conditions).toHaveLength(4);
		expect(parsed.events).toEqual([{ at: 20, stop: { name: 'App' } }]);
		// A metric condition that says nothing is read as one number for its whole window
		expect(parsed.goals[0].conditions[2]).toMatchObject({ metric: { over: 'whole window' } });
	});

	it('defaults to no events', () => {
		expect(challengeOf({ edge: { from: { name: 'A' }, to: { name: 'B' } } }).events).toEqual([]);
	});

	it('refuses a goal with no conditions and a type that is not a resource', () => {
		expect(() =>
			challengeSchema.parse({ length: 1, goals: [{ id: 'g', title: 'Empty', conditions: [] }] })
		).toThrow();
		expect(() => challengeOf({ node: { type: 'teapot' as 'sqsQueue' } })).toThrow();
		expect(() =>
			challengeOf({
				node: { name: 'App' },
				config: { name: { eq: ['Jobs'] as unknown as string } }
			})
		).toThrow();
	});

	it('refuses a script that renames a node, since its own goals name them', () => {
		const withEvent = (config: Record<string, unknown>) =>
			challengeSchema.parse({
				length: 10,
				events: [{ at: 1, set: { node: { name: 'Traffic' }, config } }],
				goals: [{ id: 'g', title: 'Goal', conditions: [{ node: { name: 'Traffic' } }] }]
			});
		expect(withEvent({ requestsPerSecond: 5 }).events).toHaveLength(1);
		expect(() => withEvent({ name: 'Something else' })).toThrow(/cannot rename/);
	});

	it('refuses a key it does not know, so a typo is never a goal that means less', () => {
		const metric = errorRate(0.1);
		expect(() => challengeOf({ metric, from: 40 } as unknown as Condition)).toThrow();
		expect(() =>
			challengeOf({ metric: { ...metric, form: 40 } } as unknown as Condition)
		).toThrow();
		expect(() =>
			challengeSchema.parse({
				length: 60,
				goals: [{ id: 'g', title: 'Goal', when: [{ node: { name: 'App' } }] }]
			})
		).toThrow();
	});

	it('refuses an event aimed at a type, which would reach the reader’s own nodes', () => {
		const aimedAt = (node: unknown) =>
			challengeSchema.parse({
				length: 60,
				events: [{ at: 1, stop: node }],
				goals: [{ id: 'g', title: 'Goal', conditions: [{ node: { name: 'App' } }] }]
			});
		expect(aimedAt({ name: 'App' }).events).toHaveLength(1);
		expect(() => aimedAt({ type: 'instanceGroup' })).toThrow();
	});

	it('refuses two goals sharing an id, so they can never score and report as one', () => {
		const goals = (first: string, second: string) => ({
			length: 60,
			goals: [
				{ id: first, title: 'Drain it', conditions: [{ node: { name: 'App' } }] },
				{ id: second, title: 'Stay up', conditions: [{ node: { name: 'LB' } }] }
			]
		});
		expect(goalIds(challengeSchema.parse(goals('drain', 'up')))).toEqual(['drain', 'up']);
		// In the order written, where an object would have put a whole number first
		expect(goalIds(challengeSchema.parse(goals('up', '1')))).toEqual(['up', '1']);
		expect(() => challengeSchema.parse(goals('drain', 'drain'))).toThrow(/Two goals share the id/);
		expect(() => challengeSchema.parse(goals('drain', ''))).toThrow();
		expect(() => challengeSchema.parse({ length: 60, goals: [] })).toThrow(/needs a goal/);
	});

	it('refuses a comparison that says nothing, which would hold for a missing setting', () => {
		expect(() => challengeOf({ node: { name: 'App' }, config: { nope: {} } })).toThrow(
			/needs eq, gte or lte/
		);
		expect(
			goalIds(challengeOf({ node: { name: 'App' }, config: { instanceCount: { gte: 1 } } }))
		).toEqual(['g']);
	});

	it('refuses an event the run would end before reaching', () => {
		const at = (seconds: number) =>
			challengeSchema.parse({
				length: 60,
				events: [{ at: seconds, stop: { name: 'App' } }],
				goals: [{ id: 'g', title: 'Goal', conditions: [{ node: { name: 'App' } }] }]
			});
		expect(at(59).events).toHaveLength(1);
		expect(() => at(60)).toThrow(/after the challenge's 60 s end/);
		expect(() => at(500)).toThrow();
	});

	it('refuses a run longer than a node keeps its metrics', () => {
		const lasting = (length: number) =>
			challengeSchema.parse({
				length,
				goals: [
					{ id: 'g', title: 'Quiet early on', conditions: [{ metric: errorRate(1, { to: 100 }) }] }
				]
			});
		expect(lasting(MAX_RUN_SECONDS).length).toBe(MAX_RUN_SECONDS);
		// The window here is only 100 s, but by the end of a longer run its datapoints are gone
		// and the goal is scored again on nothing, so the bound is on the run, not the window
		expect(() => lasting(MAX_RUN_SECONDS + 1)).toThrow(/A challenge runs for at most 900 s/);
	});

	it('refuses a window no run could close', () => {
		const judged = (window: { from?: number; to?: number }) => ({ metric: errorRate(0.1, window) });
		expect(() => challengeOf(judged({ from: 30, to: 20 }))).toThrow(/must end after it starts/);
		expect(() => challengeOf(judged({ to: 90 }))).toThrow(/length of 60 s/);
		expect(() => challengeOf(judged({ from: 60 }))).toThrow();
		const ok = judged({ from: 40 });
		expect(challengeOf(ok).goals[0].conditions[0]).toEqual(ok);
	});
});

describe('fixesSetting', () => {
	const withFixed = (fixed: unknown[], conditions?: unknown[]) =>
		challengeSchema.parse({
			length: 60,
			fixed,
			goals: [{ id: 'g', title: 'Goal', conditions: conditions ?? [{ node: { name: 'App' } }] }]
		});

	// A node of the challenge's own, which is the only kind it can fix settings on
	const fixesOn = (challenge: Challenge, name: string) =>
		fixesSetting(challenge, { name, authored: true });

	it('holds the name of a node it names, listed or not', () => {
		expect(fixesOn(withFixed([]), 'App')('name')).toBe(true);
		expect(
			fixesOn(withFixed([{ node: { name: 'App' }, include: ['command'] }]), 'App')('name')
		).toBe(true);
		// The reader's own node is theirs to rename
		expect(fixesSetting(withFixed([]), { name: 'App' })('name')).toBe(false);
	});

	it('holds nothing of its own node that it never names, the name included', () => {
		const fixes = fixesOn(withFixed([]), 'Spare');
		expect(fixes('name')).toBe(false);
		expect(fixes('instanceCount')).toBe(false);
	});

	it('fixes nothing beyond the name on a node it does not list', () => {
		const fixes = fixesOn(withFixed([{ node: { name: 'Traffic' } }]), 'App');
		expect(fixes('instanceCount')).toBe(false);
	});

	it('fixes nothing on a node the reader added, whatever it is called', () => {
		const challenge = withFixed([{ node: { name: 'Traffic' } }]);
		expect(fixesSetting(challenge, { name: 'Traffic' })('path')).toBe(false);
	});

	it('fixes nothing on a project with no challenge', () => {
		expect(fixesSetting(undefined, { name: 'Traffic', authored: true })('path')).toBe(false);
	});

	it('takes the whole node where it names neither list', () => {
		const fixes = fixesOn(withFixed([{ node: { name: 'Traffic' } }]), 'Traffic');
		// A setting the resource gains later is covered without the challenge being rewritten
		expect(fixes('path')).toBe(true);
		expect(fixes('somethingAddedLater')).toBe(true);
	});

	it('fixes only what include names', () => {
		const fixes = fixesOn(withFixed([{ node: { name: 'Traffic' }, include: ['body'] }]), 'Traffic');
		expect(fixes('body')).toBe(true);
		expect(fixes('path')).toBe(false);
	});

	it('fixes everything exclude does not, including what the resource gains later', () => {
		const fixes = fixesOn(
			withFixed([{ node: { name: 'Traffic' }, exclude: ['maxInFlight'] }]),
			'Traffic'
		);
		expect(fixes('maxInFlight')).toBe(false);
		expect(fixes('body')).toBe(true);
		expect(fixes('somethingAddedLater')).toBe(true);
	});

	it('refuses a node that names both lists', () => {
		expect(() =>
			withFixed([{ node: { name: 'Traffic' }, include: ['body'], exclude: ['path'] }])
		).toThrow(/include or exclude, not both/);
	});

	it('leaves a setting a goal compares to the reader, even on a whole fixed node', () => {
		const fixes = fixesOn(
			withFixed(
				[{ node: { name: 'App' } }],
				[{ node: { name: 'App' }, config: { instanceCount: { gte: 3 } } }]
			),
			'App'
		);
		// The challenge asks them to change it, so it cannot also be the challenge's own
		expect(fixes('instanceCount')).toBe(false);
		expect(fixes('command')).toBe(true);
	});

	it('defaults to fixing nothing', () => {
		expect(challengeOf({ node: { name: 'App' } }).fixed).toEqual([]);
	});
});

describe('matches', () => {
	// The reader's own node, of a type the canvas already has and left on its default name
	const readers = { id: 'mine', type: 'sqsQueue', config: { name: 'Jobs' } };
	const withReaders: CanvasView = { ...canvas, nodes: [...canvas.nodes, readers] };

	it('answers a name with the challenge’s own node, never one the reader added', () => {
		expect(matches(withReaders, { name: 'Jobs' }).map((n) => n.id)).toEqual(['queue']);
	});

	it('answers a type with every node of it, which is how a reader supplies one', () => {
		expect(matches(withReaders, { type: 'sqsQueue' }).map((n) => n.id)).toEqual(['queue', 'mine']);
	});
});

describe('judge', () => {
	it('checks a node and its settings against the canvas the run began with', () => {
		const enough = challengeOf({ node: { name: 'App' }, config: { instanceCount: { gte: 2 } } });
		const tooMany = challengeOf({ node: { name: 'App' }, config: { instanceCount: { gte: 3 } } });
		const named = challengeOf({ node: { type: 'sqsQueue' }, config: { name: { eq: 'Jobs' } } });
		expect(stateAt(enough, run(), 0)).toBe('met');
		expect(stateAt(tooMany, run(), 0)).toBe('failed');
		expect(stateAt(named, run(), 0)).toBe('met');
	});

	it('finds an edge between nodes named by name or by type', () => {
		const wired = challengeOf({ edge: { from: { name: 'LB' }, to: { type: 'instanceGroup' } } });
		const backwards = challengeOf({ edge: { from: { name: 'App' }, to: { name: 'LB' } } });
		expect(stateAt(wired, run(), 0)).toBe('met');
		expect(stateAt(backwards, run(), 0)).toBe('failed');
	});

	it('holds a metric through every datapoint of its window, failing where it breaks', () => {
		const low = challengeOf({
			metric: {
				node: { name: 'Jobs' },
				name: 'messages',
				statistic: 'Maximum',
				over: 'every datapoint',
				from: 10,
				to: 20,
				lte: 2
			}
		});
		const waiting = { 5: 9, 10: 2, 15: 1 };
		const drained = { ...waiting, 19: 0 };
		const backedUp = { ...waiting, 16: 3 };
		const queue = (at: Record<number, number>) => run({ metrics: () => recorded('messages', at) });
		expect(stateAt(low, queue(waiting), 5)).toBe('waiting');
		expect(stateAt(low, queue(waiting), 15)).toBe('judging');
		expect(stateAt(low, queue(drained), 20)).toBe('met');
		// The second a reading lands in has to be over before it is judged
		expect(stateAt(low, queue(backedUp), 16)).toBe('judging');
		expect(stateAt(low, queue(backedUp), 18)).toBe('failed');
	});

	it('folds a period into one reading, so a slow second inside it does not fail the goal', () => {
		const rate = challengeOf({
			metric: {
				node: { name: 'Jobs' },
				name: 'messages',
				statistic: 'Sum',
				over: 'every datapoint',
				period: 5,
				from: 10,
				to: 20,
				gte: 15
			}
		});
		const queue = (at: Record<number, number>) => run({ metrics: () => recorded('messages', at) });
		// Four a second, bar one that stalled: short per second, comfortable over five
		const bumpy = { 10: 4, 11: 4, 12: 0, 13: 4, 14: 4, 15: 4, 16: 4, 17: 4, 18: 4, 19: 4 };
		const halted = { ...bumpy, 15: 0, 16: 0, 17: 0, 18: 0, 19: 0 };
		expect(stateAt(rate, queue(bumpy), 20)).toBe('met');
		expect(stateAt(rate, queue(halted), 20)).toBe('failed');
		// The period it lands in has to be over before it is judged, as a second is without one
		expect(stateAt(rate, queue(halted), 17)).toBe('judging');
	});

	it('refuses a period that does not divide the window it is judged over', () => {
		expect(() =>
			challengeOf({
				metric: {
					node: { name: 'Jobs' },
					name: 'messages',
					statistic: 'Sum',
					over: 'every datapoint',
					period: 4,
					from: 10,
					to: 20,
					gte: 15
				}
			})
		).toThrow(/periods of 4 s/);
	});

	it('judges what a resource holds once the read it names has answered', () => {
		const stored = challengeOf({
			data: {
				node: { name: 'Accounts' },
				read: 'item',
				args: { key: '10@example.com' },
				at: 30,
				has: { hash: { eq: 'abc' } }
			}
		});
		const answered = (found?: Record<string, string>) =>
			run({
				readings: (id, c) => (id === 'table' && c === readOf(stored) ? { found } : undefined)
			});

		// Nothing is asked of a read before its moment, and nothing is known until it answers
		expect(stateAt(stored, answered({ hash: 'abc' }), 20)).toBe('waiting');
		expect(stateAt(stored, run(), 30)).toBe('judging');
		expect(stateAt(stored, answered({ hash: 'abc' }), 30)).toBe('met');
		// Something else was stored, which reads differently from nothing having been
		expect(stateAt(stored, answered({ hash: 'nope' }), 30)).toBe('failed');
		expect(stateAt(stored, answered(undefined), 30)).toBe('failed');
	});

	it('asks only that there is something there when the goal compares nothing', () => {
		const exists = challengeOf({
			data: { node: { name: 'Accounts' }, read: 'item', args: { key: '1@example.com' } }
		});
		const answered = (found?: Record<string, string>) =>
			run({
				readings: (id, c) => (id === 'table' && c === readOf(exists) ? { found } : undefined)
			});
		// No `at`, so it is read at the run's end
		expect(stateAt(exists, answered({ email: '1@example.com' }), 59)).toBe('waiting');
		expect(stateAt(exists, answered({ email: '1@example.com' }), 60)).toBe('met');
		expect(stateAt(exists, answered(undefined), 60)).toBe('failed');
	});

	it('fails a read of a type the reader never supplied, since there is nothing to read', () => {
		const supplied = challengeOf({
			data: { node: { type: 'dynamodbTable' }, read: 'item', args: { key: 'k' } }
		});
		expect(stateAt(supplied, run({ canvas: { nodes: [], edges: [] } }), 60)).toBe('failed');
	});

	it('refuses a read taken after the run is over, which nothing would ever take', () => {
		const at = (second: number) =>
			challengeOf({
				data: { node: { name: 'Accounts' }, read: 'item', args: { key: 'k' }, at: second }
			});
		expect(at(60).goals[0].conditions).toHaveLength(1);
		expect(() => at(61)).toThrow(/read at 61 s, after the challenge's 60 s end/);
	});

	it('refuses a read a resource does not offer, or arguments it cannot use', () => {
		expect(() =>
			challengeOf({ data: { node: { type: 's3Bucket' }, read: 'item', args: { key: 'k' } } })
		).toThrow(/not a read a s3Bucket offers/);
		expect(() => challengeOf({ data: { node: { type: 'dynamodbTable' }, read: 'item' } })).toThrow(
			/cannot use those arguments/
		);
		expect(() =>
			challengeOf({
				data: { node: { type: 'dynamodbTable' }, read: 'item', args: { keys: 'k' } }
			})
		).toThrow(/cannot use those arguments/);
	});

	it('meets a goal asking for any datapoint the moment one arrives', () => {
		const busy = challengeOf({
			metric: {
				node: { name: 'Jobs' },
				name: 'messages',
				statistic: 'Maximum',
				over: 'any datapoint',
				from: 10,
				to: 20,
				gte: 5
			}
		});
		const queue = (at: Record<number, number>) => run({ metrics: () => recorded('messages', at) });
		expect(stateAt(busy, queue({ 12: 1 }), 15)).toBe('judging');
		expect(stateAt(busy, queue({ 12: 1, 14: 6 }), 15)).toBe('met');
		// The one second over the bound fell outside the window, so nothing in it counts
		expect(stateAt(busy, queue({ 5: 9, 12: 1 }), 20)).toBe('failed');
	});

	it('holds a metric named by type across every node of it, not just the quietest', () => {
		const low = challengeOf({
			metric: {
				node: { type: 'sqsQueue' },
				name: 'messages',
				statistic: 'Maximum',
				over: 'whole window',
				lte: 2
			}
		});
		// A second queue of the reader's own, which a type names alongside the challenge's
		const spare = { id: 'spare', type: 'sqsQueue', config: { name: 'Spare' } };
		const pair = (jobs: Record<number, number>, theirs?: Record<number, number>) =>
			run({
				canvas: { ...canvas, nodes: [...canvas.nodes, spare] },
				metrics: (id) =>
					id === 'spare' ? (theirs ? recorded('messages', theirs) : {}) : recorded('messages', jobs)
			});
		expect(stateAt(low, pair({ 5: 9 }, { 5: 0 }), 60)).toBe('failed');
		expect(stateAt(low, pair({ 5: 1 }, { 5: 0 }), 60)).toBe('met');
		// The reader's spare queue recorded nothing, so it neither passes the goal nor breaks it
		expect(stateAt(low, pair({ 5: 1 }), 60)).toBe('met');
		expect(stateAt(low, pair({ 5: 9 }), 60)).toBe('failed');
	});

	it('fails a metric the node never recorded, so a stopped queue is not an empty one', () => {
		const low = challengeOf({
			metric: {
				node: { name: 'Jobs' },
				name: 'messages',
				statistic: 'Maximum',
				over: 'whole window',
				lte: 2
			}
		});
		const other = run({ metrics: () => recorded('requests', { 1: 5 }) });
		expect(stateAt(low, other, 1)).toBe('judging');
		expect(stateAt(low, other, 60)).toBe('failed');
	});

	it('totals the window when the goal is not judged second by second', () => {
		const busy = challengeOf({
			metric: {
				node: { name: 'App' },
				name: 'requests',
				statistic: 'Sum',
				over: 'whole window',
				from: 10,
				to: 20,
				gte: 30
			}
		});
		const served = (each: number) =>
			run({ metrics: () => recorded('requests', { 5: each, 12: each, 15: each }) });
		// The second before the window is not counted, so 2 seconds of 20 fall short of 30
		expect(stateAt(busy, served(20), 20)).toBe('met');
		expect(stateAt(busy, served(10), 20)).toBe('failed');
	});

	it('reads only the series carrying the dimensions a goal names', () => {
		const broken = challengeOf({
			metric: {
				node: { name: 'Traffic' },
				name: 'requests',
				dimensions: { status: '500' },
				statistic: 'Sum',
				over: 'whole window',
				lte: 0
			}
		});
		expect(stateAt(broken, run({ metrics: () => traffic(40, 0) }), 60)).toBe('met');
		expect(stateAt(broken, run({ metrics: () => traffic(40, 3) }), 60)).toBe('failed');
	});

	it('judges the error share once its window has closed', () => {
		const few = challengeOf({ metric: errorRate(0.05, { from: 30 }) });
		const counts = (failed: number) => run({ metrics: () => outcomes(100, failed) });
		expect(stateAt(few, counts(0), 10)).toBe('waiting');
		expect(stateAt(few, counts(0), 45)).toBe('judging');
		expect(stateAt(few, counts(5), 60)).toBe('met');
		expect(stateAt(few, counts(6), 60)).toBe('failed');
	});

	it('counts only the window, and fails a generator that sent nothing in it', () => {
		const few = challengeOf({ metric: errorRate(1, { from: 20, to: 30 }) });
		// Every request landed after the window closed, so it has nothing to vouch for
		expect(stateAt(few, run({ metrics: () => outcomes(100, 0, 40) }), 30)).toBe('failed');
		expect(stateAt(few, run({ metrics: () => outcomes(100, 0, 25) }), 30)).toBe('met');
	});

	it('meets a goal only when every condition does, and fails it when any does', () => {
		const both = challengeOf(
			{ edge: { from: { name: 'LB' }, to: { name: 'App' } } },
			{ metric: errorRate(0) }
		);
		const clean = run({ metrics: () => outcomes(10, 0) });
		expect(stateAt(both, clean, 30)).toBe('judging');
		expect(stateAt(both, clean, 60)).toBe('met');
		const unwired = challengeOf(
			{ edge: { from: { name: 'App' }, to: { name: 'LB' } } },
			{ metric: errorRate(0) }
		);
		expect(stateAt(unwired, clean, 0)).toBe('failed');
	});
});
