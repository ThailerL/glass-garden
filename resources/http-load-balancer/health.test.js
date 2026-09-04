import { describe, expect, it } from 'vitest';
import { Health, matches } from './health.js';

// What the canvas writes into config.json; the module defaults none of it
const SETTINGS = {
	path: '/',
	interval: 5,
	timeout: 2,
	healthyThreshold: 2,
	unhealthyThreshold: 2,
	matcher: '200'
};

// A Health whose probe answers from `verdicts` and whose clock only moves when a test says so
function setup() {
	const verdicts = new Map();
	const changes = [];
	let clock = 0;
	const health = new Health({
		probe: async (port) => verdicts.get(port) ?? { ok: false, reason: 'ECONNREFUSED' },
		now: () => clock,
		onChange: (port, state, reason) => changes.push({ port, state, reason })
	});
	const pass = (port) => verdicts.set(port, { ok: true });
	const fail = (port, reason = 'HTTP 500') => verdicts.set(port, { ok: false, reason });
	const advance = (seconds) => (clock += seconds * 1000);
	// Each tick is an interval later, so every target is due again
	const tick = (ports, overrides) => {
		advance(5);
		return health.tick(ports, { ...SETTINGS, ...overrides });
	};
	return { health, changes, pass, fail, advance, tick };
}

// A target registered and probed to a known state
async function healthAt(state, port = 3000) {
	const h = setup();
	const { pass, fail, tick, changes } = h;
	if (state === 'initial') return h;
	pass(port);
	await tick([port]);
	if (state !== 'healthy') {
		fail(port);
		await tick([port]);
		await tick([port]);
	}
	changes.length = 0;
	return h;
}

describe('transitions', () => {
	it('admits an initial target on its first pass, whatever the healthy threshold', async () => {
		const { health, changes, pass, tick } = await healthAt('initial');
		pass(3000);
		await tick([3000], { healthyThreshold: 5 });
		expect(changes).toEqual([{ port: 3000, state: 'healthy', reason: undefined }]);
		expect(health.choose([3000])).toEqual([3000]);
	});

	it('takes a target out after exactly the unhealthy threshold, not before', async () => {
		const { changes, fail, tick } = await healthAt('healthy');
		fail(3000);
		await tick([3000], { unhealthyThreshold: 3 });
		await tick([3000], { unhealthyThreshold: 3 });
		expect(changes).toEqual([]);
		await tick([3000], { unhealthyThreshold: 3 });
		expect(changes).toEqual([{ port: 3000, state: 'unhealthy', reason: 'HTTP 500' }]);
	});

	it('takes an initial target out after the unhealthy threshold', async () => {
		const { changes, tick } = await healthAt('initial');
		await tick([3000]);
		expect(changes).toEqual([]);
		await tick([3000]);
		expect(changes).toEqual([{ port: 3000, state: 'unhealthy', reason: 'ECONNREFUSED' }]);
	});

	it('puts a target back after exactly the healthy threshold', async () => {
		const { changes, pass, tick } = await healthAt('unhealthy');
		pass(3000);
		await tick([3000], { healthyThreshold: 3 });
		await tick([3000], { healthyThreshold: 3 });
		expect(changes).toEqual([]);
		await tick([3000], { healthyThreshold: 3 });
		expect(changes).toEqual([{ port: 3000, state: 'healthy', reason: undefined }]);
	});

	it('starts the run over when a result breaks it', async () => {
		const { health, changes, pass, fail, tick } = await healthAt('healthy');
		fail(3000);
		await tick([3000], { unhealthyThreshold: 3 });
		await tick([3000], { unhealthyThreshold: 3 });
		pass(3000);
		await tick([3000], { unhealthyThreshold: 3 });
		fail(3000);
		await tick([3000], { unhealthyThreshold: 3 });
		await tick([3000], { unhealthyThreshold: 3 });
		expect(changes).toEqual([]);
		expect(health.states([3000])).toEqual([{ port: 3000, state: 'healthy' }]);
	});

	it('reports a transition once and nothing while the state holds', async () => {
		const { changes, fail, tick } = await healthAt('healthy');
		await tick([3000]);
		await tick([3000]);
		fail(3000);
		await tick([3000]);
		await tick([3000]);
		await tick([3000]);
		expect(changes).toEqual([{ port: 3000, state: 'unhealthy', reason: 'HTTP 500' }]);
	});
});

describe('scheduling', () => {
	it('checks a new target on the tick it appears', async () => {
		const { health, changes, pass } = setup();
		pass(3000);
		await health.tick([3000], SETTINGS);
		expect(changes).toEqual([{ port: 3000, state: 'healthy', reason: undefined }]);
	});

	it('waits a full interval between checks of a target', async () => {
		const { health, changes, pass, fail, advance } = setup();
		pass(3000);
		await health.tick([3000], SETTINGS);
		changes.length = 0;
		fail(3000);
		advance(4);
		await health.tick([3000], { ...SETTINGS, unhealthyThreshold: 1 });
		expect(changes).toEqual([]);
		advance(1);
		await health.tick([3000], { ...SETTINGS, unhealthyThreshold: 1 });
		expect(changes).toEqual([{ port: 3000, state: 'unhealthy', reason: 'HTTP 500' }]);
	});

	it('runs one check per target at a time', async () => {
		let started = 0;
		let finish;
		const health = new Health({
			probe: () => {
				started += 1;
				return new Promise((resolve) => (finish = resolve));
			},
			now: () => 0
		});
		const first = health.tick([3000], SETTINGS);
		health.tick([3000], { ...SETTINGS, interval: 0 });
		expect(started).toBe(1);
		finish({ ok: true });
		await first;
		expect(health.states([3000])).toEqual([{ port: 3000, state: 'healthy' }]);
	});

	it('discards the result of a check for a target that left mid-check', async () => {
		let finish;
		const health = new Health({
			probe: () => new Promise((resolve) => (finish = resolve)),
			now: () => 0
		});
		const check = health.tick([3000], SETTINGS);
		health.tick([], SETTINGS);
		finish({ ok: true });
		await check;
		expect(health.states([3000])).toEqual([{ port: 3000, state: 'initial' }]);
	});

	it('starts a re-added target over, ignoring a check begun on its old process', async () => {
		let finish;
		const changes = [];
		const health = new Health({
			probe: () => new Promise((resolve) => (finish = resolve)),
			now: () => 0,
			onChange: (port, state) => changes.push({ port, state })
		});
		const stale = health.tick([3000], SETTINGS);
		const finishStale = finish;
		health.tick([], SETTINGS);
		const fresh = health.tick([3000], SETTINGS);
		finishStale({ ok: false, reason: 'gone' });
		await stale;
		expect(changes).toEqual([]);
		finish({ ok: true });
		await fresh;
		expect(changes).toEqual([{ port: 3000, state: 'healthy' }]);
	});

	it('does not check a target the caller dropped', async () => {
		const { health, changes, pass, tick } = await healthAt('healthy');
		await tick([]);
		pass(3001);
		await tick([3001]);
		expect(changes).toEqual([{ port: 3001, state: 'healthy', reason: undefined }]);
		expect(health.states([3000, 3001])).toEqual([
			{ port: 3000, state: 'initial' },
			{ port: 3001, state: 'healthy' }
		]);
	});
});

describe('choose', () => {
	it('routes only to healthy targets', async () => {
		const { health, pass, fail, tick } = setup();
		pass(3000);
		fail(3001);
		await tick([3000, 3001, 3002]);
		await tick([3000, 3001, 3002]);
		expect(health.choose([3000, 3001, 3002])).toEqual([3000]);
	});

	it('fails open to every target when none is healthy', async () => {
		const { health, tick } = setup();
		await tick([3000, 3001]);
		expect(health.choose([3000, 3001])).toEqual([3000, 3001]);
		await tick([3000, 3001]);
		expect(health.states([3000, 3001]).map(({ state }) => state)).toEqual([
			'unhealthy',
			'unhealthy'
		]);
		expect(health.choose([3000, 3001])).toEqual([3000, 3001]);
	});

	it('never routes to a port missing from the list it was given', async () => {
		const { health } = await healthAt('healthy');
		expect(health.choose([3001])).toEqual([3001]);
		expect(health.choose([])).toEqual([]);
	});

	it('routes to a port it has not seen yet only when nothing it has seen is healthy', async () => {
		const { health } = await healthAt('healthy');
		expect(health.choose([3000, 3001])).toEqual([3000]);
		expect(new Health().choose([3000, 3001])).toEqual([3000, 3001]);
	});
});

describe('states', () => {
	it('names each port in the given list with its state', async () => {
		const { health } = await healthAt('healthy');
		expect(health.states([3000, 3001])).toEqual([
			{ port: 3000, state: 'healthy' },
			{ port: 3001, state: 'initial' }
		]);
	});
});

describe('matches', () => {
	it('matches a single code exactly', () => {
		expect(matches('200', 199)).toBe(false);
		expect(matches('200', 200)).toBe(true);
		expect(matches('200', 201)).toBe(false);
	});

	it('matches a range inclusively', () => {
		expect(matches('200-299', 199)).toBe(false);
		expect(matches('200-299', 200)).toBe(true);
		expect(matches('200-299', 299)).toBe(true);
		expect(matches('200-299', 300)).toBe(false);
	});

	it('accepts a list with whitespace', () => {
		expect(matches(' 200, 204 , 300-399 ', 204)).toBe(true);
		expect(matches(' 200, 204 , 300-399 ', 302)).toBe(true);
		expect(matches(' 200, 204 , 300-399 ', 201)).toBe(false);
	});

	it('matches nothing when any part is malformed', () => {
		expect(matches('', 200)).toBe(false);
		expect(matches('2xx', 200)).toBe(false);
		expect(matches('200,ok', 200)).toBe(false);
		expect(matches('20-299', 200)).toBe(false);
	});
});
