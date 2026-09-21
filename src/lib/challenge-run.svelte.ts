import {
	eventTarget,
	goalIds,
	judge,
	matches,
	type CanvasView,
	type Challenge,
	type GoalState,
	type RunRecord,
	type ScriptEvent
} from './challenge';
import type { MetricStore } from './resource-log.svelte';
import type { ResourceStatus } from './resources';
import { createContext } from './context';

export const TICK_MS = 250;

export type RunServices = {
	canvas: () => CanvasView;
	statuses: () => Record<string, ResourceStatus>;
	metrics: (nodeId: string) => MetricStore;
	startAll: () => void;
	start: (nodeId: string) => void;
	stop: (nodeId: string) => void;
	setConfig: (nodeId: string, patch: Record<string, unknown>) => void;
	stopAll: () => void;
	finished: (result: { met: string[]; failed: string[] }) => void;
	failedToStart: (nodeName: string) => void;
};

// 'ended' is a run that stopped before its length and was not scored
export type RunPhase = 'idle' | 'starting' | 'running' | 'done' | 'ended';

// Why a run ended unscored, as a reason rather than a sentence: the panel words it and the host
// is sent the code. The id navigates to the node and the name is what a reader is shown, so the
// one place that knows both hands both on
export type RunEnd =
	{ reason: 'stopped' } | { reason: 'did-not-start'; nodeId: string; nodeName: string };

const NOT_STARTING: readonly ResourceStatus[] = ['crashed', 'unresponsive'];

const sameStates = (a: Record<string, GoalState>, b: Record<string, GoalState>) =>
	Object.keys(b).every((id) => a[id] === b[id]);

// Starts everything, waits for it all to run, then plays the script and judges the goals.
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
	#timer: ReturnType<typeof setInterval> | undefined;
	#startedAt = 0;
	// The canvas the run is judged against, as it stood when the clock started
	#record: RunRecord | undefined;
	#nextEvent = 0;

	constructor(challenge: Challenge, services: RunServices) {
		this.challenge = challenge;
		this.#services = services;
		this.#events = [...challenge.events].sort((a, b) => a.at - b.at);
		this.goals = this.#allWaiting();
	}

	get active() {
		return this.phase === 'starting' || this.phase === 'running';
	}

	start() {
		if (this.active) return;
		this.phase = 'starting';
		this.elapsed = 0;
		this.ended = undefined;
		this.goals = this.#allWaiting();
		this.failedAt = {};
		this.#services.startAll();
		this.#timer = setInterval(() => this.#tick(), TICK_MS);
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
			this.#services.failedToStart(nodeName);
			return;
		}
		if (!canvas.nodes.every((node) => statuses[node.id] === 'running')) return;

		this.#startedAt = Date.now();
		this.#nextEvent = 0;
		this.#record = {
			length: this.challenge.length,
			canvas,
			startedAt: this.#startedAt,
			metrics: this.#services.metrics
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
		const goals = judge(this.challenge, record, this.elapsed);
		if (!sameStates(this.goals, goals)) {
			for (const [id, state] of Object.entries(goals)) {
				if (state !== 'failed' || this.goals[id] === 'failed') continue;
				this.failedAt = { ...this.failedAt, [id]: Math.floor(this.elapsed) };
			}
			this.goals = goals;
		}
		if (t < length) return;
		this.#end('done');
		this.#services.stopAll();
		// Every window has closed by the end, so a goal not met has failed
		const ids = Object.keys(goals);
		this.#services.finished({
			met: ids.filter((id) => goals[id] === 'met'),
			failed: ids.filter((id) => goals[id] !== 'met')
		});
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
	}
}

// Held above the routes, so opening the editor mid-run leaves the run going. Undefined on a
// project with no challenge
const runContext = createContext<ChallengeRun | undefined>('CHALLENGE_RUN');

export const setChallengeRun = runContext.set;
export const getChallengeRun = runContext.get;

// What the reader prepared is what the run judges, so every edit waits for it to end
export const LOCKED_UNTIL_RUN_ENDS = 'Save once the run ends';

export function getEditingLock() {
	const run = getChallengeRun();
	return {
		get current() {
			return run?.active ?? false;
		}
	};
}
