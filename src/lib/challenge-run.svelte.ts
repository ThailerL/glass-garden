import { eventTarget, goalSpan, momentOf } from './challenge-timeline';
import {
	dataConditions,
	goalIds,
	judge,
	matches,
	type CanvasView,
	type Challenge,
	type DataCondition,
	type GoalState,
	type Reading,
	type RunRecord,
	type ScriptEvent
} from './challenge';
import type { MetricStore } from './resource-log.svelte';
import type { ResourceStatus } from './resources';
import type { Scalar } from './resources/types';
import { createContext } from './context';

export const TICK_MS = 250;

export type RunServices = {
	canvas: () => CanvasView;
	statuses: () => Record<string, ResourceStatus>;
	metrics: (nodeId: string) => MetricStore;
	startsLast: (type: string) => boolean;
	settled: () => boolean;
	start: (nodeId: string) => void;
	stop: (nodeId: string) => void;
	setConfig: (nodeId: string, patch: Record<string, unknown>) => void;
	stopAll: () => void;
	clearStoredData: () => Promise<{ nodeId: string; nodeName: string } | undefined>;
	read: (
		nodeId: string,
		read: string,
		args: Record<string, unknown>
	) => Promise<Record<string, Scalar> | undefined>;
	finished: (result: { met: string[]; failed: string[] }) => void;
	// Every way a run ends without a score, so a new one is reported without being wired up
	unscored: (end: RunEnd) => void;
};

// 'ended' is a run that stopped before its length and was not scored
export type RunPhase = 'idle' | 'starting' | 'running' | 'done' | 'ended';

// Why a run ended unscored, as a reason rather than a sentence: the panel words it and the host
// is sent the code. The id navigates to the node and the name is what a reader is shown, so the
// one place that knows both hands both on
export type RunEnd =
	| { reason: 'stopped' }
	| { reason: 'did-not-start'; nodeId: string; nodeName: string }
	| { reason: 'not-cleared'; nodeId: string; nodeName: string };

const NOT_STARTING: readonly ResourceStatus[] = ['crashed', 'unresponsive'];

const sameStates = (a: Record<string, GoalState>, b: Record<string, GoalState>) =>
	Object.keys(b).every((id) => a[id] === b[id]);

// One read of one node. Private to the runner: the judge asks in the terms it already holds
function readKey(nodeId: string, c: DataCondition): string {
	return JSON.stringify([nodeId, c.read, c.args, c.at]);
}

// Starts the traffic last, waits for everything to run, then plays the script and judges the goals.
// The clock only starts once every node is up, so a slow boot never eats into the run
export class ChallengeRun {
	phase = $state<RunPhase>('idle');
	elapsed = $state(0);
	goals = $state.raw<Record<string, GoalState>>({});
	// The whole second each goal failed at in this run, which its state alone does not keep
	failedAt = $state.raw<Record<string, number>>({});
	ended = $state.raw<RunEnd | undefined>();

	// As this canvas runs it, so the panel reads the same copy the judge does
	readonly challenge: Challenge;
	#services: RunServices;
	#events: Challenge['events'];
	#reads: DataCondition[];
	#timer: ReturnType<typeof setInterval> | undefined;
	#startedAt = 0;
	// The canvas the run is judged against, as it stood when the clock started
	#record: RunRecord | undefined;
	#nextEvent = 0;
	#lateStarted = false;
	// Asked once each: a key present but undefined is a read still in flight. Not reactive,
	// since judging reads them on the tick that follows
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#readings = new Map<string, Reading | undefined>();

	constructor(challenge: Challenge, services: RunServices) {
		this.challenge = challenge;
		this.#services = services;
		this.#events = [...challenge.events].sort((a, b) => a.at - b.at);
		this.#reads = dataConditions(challenge);
		this.goals = this.#allWaiting();
	}

	get active() {
		return this.phase === 'starting' || this.phase === 'running';
	}

	// Stopped and cleared before the clock, so the same canvas runs the same way twice
	async start() {
		if (this.active) return;
		this.phase = 'starting';
		this.elapsed = 0;
		this.ended = undefined;
		this.goals = this.#allWaiting();
		this.failedAt = {};
		this.#lateStarted = false;
		this.#services.stopAll();
		const uncleared = await this.#services.clearStoredData();
		if (uncleared) return this.#end('ended', { reason: 'not-cleared', ...uncleared });
		// Stop run, pressed while that was in flight, has already ended this one
		if (this.phase !== 'starting') return;
		this.#startNodes(false);
		this.#timer = setInterval(() => this.#tick(), TICK_MS);
	}

	#startNodes(last: boolean) {
		for (const node of this.#services.canvas().nodes) {
			if (this.#services.startsLast(node.type) === last) this.#services.start(node.id);
		}
	}

	// The reader's way out, which ends it the same way reaching the end does
	stop() {
		if (!this.active) return;
		this.#services.stopAll();
		this.#end('ended', { reason: 'stopped' });
	}

	dispose() {
		clearInterval(this.#timer);
	}

	#allWaiting() {
		return Object.fromEntries(goalIds(this.challenge).map((id) => [id, 'waiting' as GoalState]));
	}

	#tick() {
		if (this.phase === 'starting') this.#awaitRunning();
		else if (this.phase === 'running') this.#play();
	}

	#awaitRunning() {
		const canvas = this.#services.canvas();
		const statuses = this.#services.statuses();
		const broken = canvas.nodes.find((node) => NOT_STARTING.includes(statuses[node.id]));
		if (broken) {
			// Left as it is: the node that crashed is the thing the reader has to look at
			const nodeName = broken.config.name as string;
			this.#end('ended', { reason: 'did-not-start', nodeId: broken.id, nodeName });
			return;
		}
		// Traffic sent before the rest can answer it is refused and still counted
		if (!this.#lateStarted) {
			const earlyUp = canvas.nodes.every(
				(node) => this.#services.startsLast(node.type) || statuses[node.id] === 'running'
			);
			if (!earlyUp) return;
			if (!this.#services.settled()) return;
			this.#startNodes(true);
			this.#lateStarted = true;
		}
		if (!canvas.nodes.every((node) => statuses[node.id] === 'running')) return;

		this.#startedAt = Date.now();
		this.#nextEvent = 0;
		this.#readings.clear();
		this.#record = {
			length: this.challenge.length,
			canvas,
			startedAt: this.#startedAt,
			metrics: this.#services.metrics,
			readings: (nodeId, c) => this.#readings.get(readKey(nodeId, c))
		};
		this.phase = 'running';
		this.#play();
	}

	#play() {
		const record = this.#record!;
		const t = (Date.now() - this.#startedAt) / 1000;
		while (this.#nextEvent < this.#events.length && this.#events[this.#nextEvent].at <= t) {
			this.#apply(this.#events[this.#nextEvent++]);
		}
		const { length } = this.challenge;
		this.elapsed = Math.min(t, length);
		this.#readDue(record, this.elapsed);
		const goals = judge(this.challenge, record, this.elapsed);
		if (!sameStates(this.goals, goals)) {
			for (const [id, state] of Object.entries(goals)) {
				if (state !== 'failed' || this.goals[id] === 'failed') continue;
				// A goal the canvas answers is decided before the clock starts, so there is no
				// second to record and the panel says nothing the mark and its row have not
				const goal = this.challenge.goals.find((one) => one.id === id);
				if (!goal || !goalSpan(goal, length)) continue;
				this.failedAt = { ...this.failedAt, [id]: Math.floor(this.elapsed) };
			}
			this.goals = goals;
		}
		if (t < length) return;
		// Everything down before the reads taken at the end are waited on: they would otherwise
		// be competing for the machine with the system they are measuring, at its busiest
		this.#services.stopAll();
		// The clock running out is not the same as the run being knowable. Each read has a
		// timeout behind it, so a region that never answers cannot hold this open for long
		if ([...this.#readings.values()].some((reading) => reading === undefined)) return;
		this.#end('done');
		// Every window has closed by the end, so a goal not met has failed
		const ids = Object.keys(goals);
		this.#services.finished({
			met: ids.filter((id) => goals[id] === 'met'),
			failed: ids.filter((id) => goals[id] !== 'met')
		});
	}

	// The answer lands whenever it arrives, so the goal reads 'judging' until then
	#readDue(record: RunRecord, t: number) {
		for (const condition of this.#reads) {
			if (t < momentOf(condition, this.challenge.length)) continue;
			for (const node of matches(record.canvas, condition.node)) {
				const key = readKey(node.id, condition);
				if (this.#readings.has(key)) continue;
				this.#readings.set(key, undefined);
				void this.#services
					.read(node.id, condition.read, condition.args)
					.then((found) => this.#readings.set(key, { found }))
					// A read that could not be taken cannot satisfy a goal, and leaving it pending
					// would hold the run open waiting for an answer that is never coming
					.catch(() => this.#readings.set(key, {}));
			}
		}
	}

	#apply(event: ScriptEvent) {
		// A name is unique among the nodes the challenge laid down, so this is the one it meant
		const [node] = matches(this.#services.canvas(), eventTarget(event));
		if (!node) return;
		if ('start' in event) this.#services.start(node.id);
		else if ('stop' in event) this.#services.stop(node.id);
		else {
			this.#services.setConfig(node.id, event.set.config);
			// Re-read so a goal about the setting the script just changed judges the new value
			this.#record!.canvas = this.#services.canvas();
		}
	}

	#end(phase: 'done' | 'ended', end?: RunEnd) {
		this.ended = end;
		clearInterval(this.#timer);
		this.#timer = undefined;
		this.phase = phase;
		if (end) this.#services.unscored(end);
	}
}

// Held above the routes, so opening the editor mid-run leaves the run going. Undefined on a
// project with no challenge
const runContext = createContext<ChallengeRun | undefined>('CHALLENGE_RUN');

export const setChallengeRun = runContext.set;
export const getChallengeRun = runContext.get;

// What the reader prepared is what the run judges, so every edit waits for it to end
export const LOCKED_UNTIL_RUN_ENDS = 'Save once the run ends';

// A hand on these would be measured as the system's own behaviour, so they wait too
export const RUN_DRIVES_THE_CANVAS =
	'A run starts and stops the canvas on its own script, so these wait until it ends';

export function getEditingLock() {
	const run = getChallengeRun();
	return {
		get current() {
			return run?.active ?? false;
		}
	};
}
