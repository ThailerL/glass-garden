import {
	eventTarget,
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

export const TICK_MS = 250;

export type RunServices = {
	canvas: () => CanvasView;
	statuses: () => Record<string, ResourceStatus>;
	metrics: (nodeId: string) => MetricStore;
	startAll: () => void;
	start: (nodeId: string) => void;
	stop: (nodeId: string) => void;
	setConfig: (nodeId: string, patch: Record<string, unknown>) => void;
	// Takes the start and stop buttons away from the reader for as long as the run lasts
	hold: (held: boolean) => void;
	finished: (met: string[]) => void;
};

// 'ended' is a run that stopped before its length and was not scored
export type RunPhase = 'idle' | 'starting' | 'running' | 'done' | 'ended';

const NOT_STARTING: readonly ResourceStatus[] = ['crashed', 'unresponsive'];

// What the reader controls, so a node moving or its ports being reserved is not an edit
function signature({ nodes, edges }: CanvasView) {
	return JSON.stringify([nodes, edges]);
}

const sameStates = (a: Record<string, GoalState>, b: Record<string, GoalState>) =>
	Object.keys(b).every((id) => a[id] === b[id]);

// Starts everything, waits for it all to run, then plays the script and judges the goals.
// The clock only starts once every node is up, so a slow boot never eats into the run
export class ChallengeRun {
	phase = $state<RunPhase>('idle');
	elapsed = $state(0);
	goals = $state.raw<Record<string, GoalState>>({});
	endedBecause = $state<string | undefined>();

	#challenge: Challenge;
	#services: RunServices;
	#events: Challenge['events'];
	#timer: ReturnType<typeof setInterval> | undefined;
	#startedAt = 0;
	// The canvas the run is judged against, which the edit check compares to as well: one
	// baseline, so a script's own change moves both
	#record: RunRecord | undefined;
	#nextEvent = 0;

	constructor(challenge: Challenge, services: RunServices) {
		this.#challenge = challenge;
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
		this.endedBecause = undefined;
		this.goals = this.#allWaiting();
		this.#services.hold(true);
		this.#services.startAll();
		this.#timer = setInterval(() => this.#tick(), TICK_MS);
	}

	stop(reason = 'Stopped before the end, so it was not scored') {
		if (!this.active) return;
		this.#end('ended');
		this.endedBecause = reason;
	}

	dispose() {
		if (this.active) this.#services.hold(false);
		clearInterval(this.#timer);
	}

	#allWaiting() {
		return Object.fromEntries(this.#challenge.goals.map((g) => [g.id, 'waiting' as GoalState]));
	}

	#tick() {
		if (this.phase === 'starting') this.#awaitRunning();
		else if (this.phase === 'running') this.#play();
	}

	#awaitRunning() {
		const canvas = this.#services.canvas();
		const statuses = this.#services.statuses();
		const broken = canvas.nodes.find((node) => NOT_STARTING.includes(statuses[node.id]));
		if (broken) return this.stop(`${broken.config.name} did not start, so the run was not scored`);
		if (!canvas.nodes.every((node) => statuses[node.id] === 'running')) return;

		this.#startedAt = Date.now();
		this.#nextEvent = 0;
		this.#record = {
			length: this.#challenge.length,
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
		if (signature(this.#services.canvas()) !== signature(record.canvas)) {
			return this.stop('The canvas changed during the run, so it was not scored');
		}
		while (this.#nextEvent < this.#events.length && this.#events[this.#nextEvent].at <= t) {
			this.#apply(this.#events[this.#nextEvent++]);
		}
		const { length } = this.#challenge;
		this.elapsed = Math.min(t, length);
		const goals = judge(this.#challenge, record, this.elapsed);
		if (!sameStates(this.goals, goals)) this.goals = goals;
		if (t < length) return;
		this.#end('done');
		this.#services.finished(Object.keys(goals).filter((id) => goals[id] === 'met'));
	}

	#apply(event: ScriptEvent) {
		// A name is unique among the nodes the challenge laid down, so this is the one it meant
		const [node] = matches(this.#services.canvas(), eventTarget(event));
		if (!node) return;
		if ('start' in event) this.#services.start(node.id);
		else if ('stop' in event) this.#services.stop(node.id);
		else {
			this.#services.setConfig(node.id, event.set.config);
			// The script's own change is not the reader's edit, and the goals see it too
			this.#record!.canvas = this.#services.canvas();
		}
	}

	#end(phase: 'done' | 'ended') {
		clearInterval(this.#timer);
		this.#timer = undefined;
		this.#services.hold(false);
		this.phase = phase;
	}
}
