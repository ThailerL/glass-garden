import http from 'node:http';

const HEALTH_CHECKER = 'ELB-HealthChecker/2.0';

// A refused connection arrives as an AggregateError whose own message is empty, one entry per
// address tried, so the code is the only thing that names the failure
export const reasonOf = (error) => error.message || error.code || String(error);

// ALB's Matcher, "200,204,300-399". Unparseable matches nothing, so a bad matcher fails closed
export function matches(matcher, status) {
	const ranges = [];
	for (const part of String(matcher).split(',')) {
		const found = /^\s*(\d{3})\s*(?:-\s*(\d{3}))?\s*$/.exec(part);
		if (!found) return false;
		ranges.push([Number(found[1]), Number(found[2] ?? found[1])]);
	}
	return ranges.some(([low, high]) => status >= low && status <= high);
}

// Never rejects; the reason names refused, timed out and wrong status apart for the log
function probe(port, { path, timeout, matcher }) {
	return new Promise((resolve) => {
		const request = http.request(
			{
				host: 'localhost',
				port,
				path,
				headers: { 'user-agent': HEALTH_CHECKER },
				signal: AbortSignal.timeout(timeout * 1000)
			},
			(response) => {
				response.resume();
				if (matches(matcher, response.statusCode)) resolve({ ok: true });
				else resolve({ ok: false, reason: `HTTP ${response.statusCode}` });
			}
		);
		request.on('error', (error) => {
			const reason = error.name === 'AbortError' ? `no response within ${timeout}s` : reasonOf(error);
			resolve({ ok: false, reason });
		});
		request.end();
	});
}

// Health belongs to the target group, not the instance, as in an ALB
export class Health {
	#targets = new Map();
	#probe;
	#now;
	#onChange;

	constructor({ probe: check = probe, now = Date.now, onChange = () => {} } = {}) {
		this.#probe = check;
		this.#now = now;
		this.#onChange = onChange;
	}

	// Registers what is there, drops what is not, and checks each target that is due.
	// Resolves when this tick's checks have all landed
	tick(ports, settings) {
		for (const port of ports) {
			if (this.#targets.has(port)) continue;
			// Never checked, so due now
			this.#targets.set(port, { state: 'initial', run: 0, startedAt: -Infinity, checking: false });
		}
		for (const port of this.#targets.keys()) {
			if (!ports.includes(port)) this.#targets.delete(port);
		}

		const now = this.#now();
		const checks = [];
		for (const [port, target] of this.#targets) {
			if (target.checking || now - target.startedAt < settings.interval * 1000) continue;
			checks.push(this.#check(port, target, now, settings));
		}
		return Promise.all(checks);
	}

	async #check(port, target, now, settings) {
		target.startedAt = now;
		target.checking = true;
		const result = await this.#probe(port, settings);
		// The target was re-registered mid-check, so this verdict is about a process that is gone
		if (this.#targets.get(port) !== target) return;
		target.checking = false;
		const state = this.#record(target, result.ok, settings);
		if (state !== undefined) this.#onChange(port, state, result.reason);
	}

	// Returns the new state when a result changes it. A first pass admits a target whatever
	// the healthy threshold says, as an ALB does
	#record(target, ok, { healthyThreshold, unhealthyThreshold }) {
		target.run = target.lastOk === ok ? target.run + 1 : 1;
		target.lastOk = ok;

		let to;
		if (ok && target.state === 'initial') to = 'healthy';
		else if (ok && target.state === 'unhealthy' && target.run >= healthyThreshold) to = 'healthy';
		else if (!ok && target.state !== 'unhealthy' && target.run >= unhealthyThreshold) {
			to = 'unhealthy';
		}
		if (to !== undefined) target.state = to;
		return to;
	}

	#stateOf(port) {
		return this.#targets.get(port)?.state ?? 'initial';
	}

	// Filters the caller's list, not the map, so unseen ports route; fails open when none is healthy
	choose(ports) {
		const healthy = ports.filter((port) => this.#stateOf(port) === 'healthy');
		return healthy.length > 0 ? healthy : ports;
	}

	states(ports) {
		return ports.map((port) => ({ port, state: this.#stateOf(port) }));
	}
}
