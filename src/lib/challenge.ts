import { z } from 'zod';
import { resourceTypeSchema } from './resources';
import {
	breakDown,
	MAX_DATAPOINTS,
	METRIC_STATISTICS,
	metricTotals,
	metricWindow,
	NO_BREAKDOWN,
	PERIOD_MS,
	type Dimensions,
	type MetricSeries
} from './metrics';
import type { MetricStore } from './resource-log.svelte';

// Nodes are named, never carried by id: ids are minted fresh on import, so an id written into
// a challenge would point at the canvas it was authored on. A name matches one node; a type
// matches every node of it, which is how a challenge asks the reader to supply one
const namedRef = z.strictObject({ name: z.string().min(1) });
const nodeRef = z.union([namedRef, z.strictObject({ type: resourceTypeSchema })]);
export type NamedRef = z.infer<typeof namedRef>;
export type NodeRef = z.infer<typeof nodeRef>;

const comparison = z
	.strictObject({
		// Every kind a setting holds; an object or a list could never equal one
		eq: z.union([z.string(), z.number(), z.boolean()]).optional(),
		gte: z.number().optional(),
		lte: z.number().optional()
	})
	// Nothing to compare holds for any value, including a setting the node does not have
	.refine((c) => c.eq !== undefined || c.gte !== undefined || c.lte !== undefined, {
		error: 'A setting comparison needs eq, gte or lte'
	});
export type Comparison = z.infer<typeof comparison>;

// A node keeps this many one-second datapoints and no more. Goals are scored at the end of the
// run, by which point a longer run has dropped the datapoints its early windows were about
export const MAX_RUN_SECONDS = (MAX_DATAPOINTS * PERIOD_MS) / 1000;

// How a metric condition's window is read: one number, or one for each datapoint in it
const metricRead = z.enum(['whole window', 'every datapoint', 'any datapoint']);

// Any metric a node records, read the way the metrics tab reads it, so a goal and a chart
// of the same metric can never disagree. `read` is whether the window folds into one number
// or is judged datapoint by datapoint, each one a second of the run as the store keeps it
const metricCondition = z
	.strictObject({
		node: nodeRef,
		name: z.string().min(1),
		dimensions: z.record(z.string(), z.string()).optional(),
		statistic: z.enum(METRIC_STATISTICS),
		read: metricRead.default('whole window'),
		// Seconds from the moment every node reports running; a window given no end runs
		// to the end of the challenge
		from: z.number().min(0).optional(),
		to: z.number().positive().optional(),
		lte: z.number().optional(),
		gte: z.number().optional()
	})
	.refine((m) => m.lte !== undefined || m.gte !== undefined, {
		error: 'A metric condition needs lte, gte, or both'
	});
export type MetricCondition = z.infer<typeof metricCondition>;

// Declarative only: a challenge arrives in a share link, which is anyone's text. Every object
// is strict, since hand-editing is the only way to author one and a key the schema ignored
// would leave a goal quietly meaning something other than what it says
const condition = z.union([
	z.strictObject({
		node: z.strictObject({
			ref: nodeRef,
			config: z.record(z.string(), comparison).optional()
		})
	}),
	z.strictObject({ edge: z.strictObject({ from: nodeRef, to: nodeRef }) }),
	z.strictObject({ metric: metricCondition })
]);
export type Condition = z.infer<typeof condition>;

// Every condition has to hold for the goal to be met. The id is what a run is scored by and
// what the embedding page is told, so it names one goal and no other
const goal = z.strictObject({
	id: z.string().min(1),
	title: z.string().min(1),
	hint: z.string().min(1).optional(),
	conditions: z.array(condition).min(1)
});
export type Goal = z.infer<typeof goal>;

// Events act on the nodes they name the way those nodes' own buttons and settings would, and
// name one node each: an event is the author acting on their own system, so it never reaches a
// node the reader added, whose settings are theirs and whose presence the script cannot count on
const timing = {
	at: z.number().min(0),
	// The author's own words for what happens, since a setting's name is code vocabulary
	text: z.string().min(1).optional()
};
const scriptEvent = z.union([
	z.strictObject({ ...timing, start: namedRef }),
	z.strictObject({ ...timing, stop: namedRef }),
	z.strictObject({
		...timing,
		set: z.strictObject({
			node: namedRef,
			// A rename would detach the challenge's own references, so a script cannot make one
			config: z
				.record(z.string(), z.unknown())
				.refine((config) => !('name' in config), { error: 'A script cannot rename a node' })
		})
	})
]);
export type ScriptEvent = z.infer<typeof scriptEvent>;

// The settings a challenge owns rather than the reader: the whole node, only what include
// names, or everything exclude does not
const fixedNode = z
	.strictObject({
		node: namedRef,
		include: z.array(z.string().min(1)).min(1).optional(),
		exclude: z.array(z.string().min(1)).min(1).optional()
	})
	.refine((f) => !(f.include && f.exclude), {
		error: 'A fixed node takes include or exclude, not both'
	});
export type FixedNode = z.infer<typeof fixedNode>;

export const challengeSchema = z
	.strictObject({
		length: z.number().positive(),
		events: z.array(scriptEvent).default([]),
		fixed: z.array(fixedNode).default([]),
		goals: z.array(goal).min(1)
	})
	// Everything a single value cannot say: what the run's length leaves room for, and whether
	// the goals name themselves apart
	.superRefine(({ length, events, goals }, ctx) => {
		const problem = (message: string) => ctx.addIssue({ code: 'custom', message });
		// Every goal is scored again at the end, so a run must be short enough that no window it
		// judges has been evicted by then. Bounding each window instead would not do it: a short
		// window early in a long run is the case that breaks
		if (length > MAX_RUN_SECONDS) {
			problem(
				`A challenge runs for at most ${MAX_RUN_SECONDS} s, which is as much of a metric as a node keeps, and its goals are scored at the end`
			);
		}
		const ids = new Set<string>();
		for (const goal of goals) {
			// One state per id, so two goals of an id would score and report as one
			if (ids.has(goal.id)) problem(`Two goals share the id "${goal.id}"`);
			ids.add(goal.id);
			for (const condition of goal.conditions) {
				const window = conditionWindow(condition, length);
				if (!window) continue;
				const [open, close] = window;
				// A window that never closes, or closes before it opens, is a goal no run can meet
				if (open < close && close <= length) continue;
				problem(
					`The goal "${goal.title}" is judged from ${open} s to ${close} s, which must end after it starts and by the challenge's length of ${length} s`
				);
			}
		}
		for (const event of events) {
			// The run ends at its length, so anything due then or later never happens
			if (event.at < length) continue;
			problem(`The script has an event at ${event.at} s, after the challenge's ${length} s end`);
		}
	});
export type Challenge = z.infer<typeof challengeSchema>;

// Every node a challenge points at, said in the words a problem with it is reported in, with
// the settings a goal compares where it names any. One walk, so a condition or event kind
// added later cannot be checked in one place and forgotten in another
export type ChallengeRef = {
	where: string;
	ref: NodeRef;
	config?: Record<string, Comparison>;
};

export function* challengeRefs(challenge: Challenge): Generator<ChallengeRef> {
	for (const goal of challenge.goals) {
		const where = `The goal "${goal.title}"`;
		for (const c of goal.conditions) {
			if ('node' in c) yield { where, ref: c.node.ref, config: c.node.config };
			else if ('edge' in c) yield* [c.edge.from, c.edge.to].map((ref) => ({ where, ref }));
			else yield { where, ref: c.metric.node };
		}
	}
	for (const event of challenge.events) {
		yield { where: `The event at ${event.at} s`, ref: eventTarget(event) };
	}
	for (const { node } of challenge.fixed) {
		yield { where: `The settings fixed on "${node.name}"`, ref: node };
	}
}

// Whether the challenge owns a setting on one of its nodes. A goal that compares a setting is
// the challenge asking the reader to change it, so it stays theirs even under 'all'
const NOTHING_FIXED = () => false;

export function fixesSetting(
	challenge: Challenge | undefined,
	node: { name: string; authored?: boolean }
): (setting: string) => boolean {
	// The challenge's own node, by the rule matches() applies: one the reader added and left on
	// a default name is not the node it meant
	if (!challenge || !node.authored) return NOTHING_FIXED;
	const fixed = challenge.fixed.find((entry) => entry.node.name === node.name);
	// A rename would detach every goal, event and fixed entry naming this node, all at once
	if (!fixed) return (setting) => setting === 'name';
	const compared = comparedSettings(challenge).get(node.name);
	const { include, exclude } = fixed;
	return (setting) =>
		setting === 'name' ||
		(!compared?.has(setting) &&
			(include ? include.includes(setting) : !exclude?.includes(setting)));
}

// The settings each node's goals compare, which is the challenge asking the reader to change
// them. Shared with the document's checks, so what it reports is what the inspector does
export function comparedSettings(challenge: Challenge): Map<string, Set<string>> {
	const compared = new Map<string, Set<string>>();
	for (const { ref, config } of challengeRefs(challenge)) {
		if (!('name' in ref) || !config) continue;
		const keys = compared.get(ref.name) ?? new Set<string>();
		for (const key of Object.keys(config)) keys.add(key);
		compared.set(ref.name, keys);
	}
	return compared;
}

// One owner for the denominator an embedding page is told, in the order the challenge lists them
export function goalIds(challenge: Challenge): string[] {
	return challenge.goals.map((goal) => goal.id);
}

// The one node an event acts on, whichever kind it is
export function eventTarget(event: ScriptEvent): NamedRef {
	if ('start' in event) return event.start;
	if ('stop' in event) return event.stop;
	return event.set.node;
}

export type CanvasNode = {
	id: string;
	type: string;
	config: Record<string, unknown>;
	// Laid down by the challenge rather than added by the reader
	authored?: boolean;
};
export type CanvasView = {
	nodes: readonly CanvasNode[];
	edges: readonly { source: string; target: string }[];
};

// What a run is judged against: the canvas as it began, and each node's metrics, which the
// nodes themselves keep recording. Seconds of the run are turned into clock times by startedAt
export type RunRecord = {
	length: number;
	canvas: CanvasView;
	startedAt: number;
	metrics: (nodeId: string) => MetricStore;
};

export type GoalState = 'waiting' | 'judging' | 'met' | 'failed';

// A name picks out one of the challenge's own nodes, so a reader who drags in a second queue
// and leaves it on its default name cannot answer for the author's. A type is the opposite: it
// describes a role, and the reader's node filling it is the point
export function matches(canvas: CanvasView, ref: NodeRef): CanvasNode[] {
	if ('type' in ref) return canvas.nodes.filter((node) => node.type === ref.type);
	return canvas.nodes.filter((node) => node.authored && node.config.name === ref.name);
}

// What a metric condition judges by, and the numeric half of a setting comparison
type Bounds = { gte?: number; lte?: number };

const within = (value: number, { gte, lte }: Bounds) =>
	(gte === undefined || value >= gte) && (lte === undefined || value <= lte);

// A setting is whatever the document put there, so a bound only holds for a number
function compare(value: unknown, { eq, gte, lte }: z.infer<typeof comparison>): boolean {
	if (eq !== undefined && value !== eq) return false;
	if (gte === undefined && lte === undefined) return true;
	return typeof value === 'number' && within(value, { gte, lte });
}

function windowOf(c: { from?: number; to?: number }, length: number): [number, number] {
	return [c.from ?? 0, c.to ?? length];
}

// The stretch a condition is judged over, or nothing for one checked as the run starts. One
// rule, so the judge, the document's checks and the panel's timeline cannot come to disagree
export function conditionWindow(c: Condition, length: number): [number, number] | undefined {
	return 'metric' in c ? windowOf(c.metric, length) : undefined;
}

// When each of a goal's conditions is judged
export function windowsOf(goal: Goal, length: number) {
	const windows = goal.conditions.map((c) => conditionWindow(c, length));
	return {
		atStart: windows.some((window) => window === undefined),
		judged: windows.filter((window) => window !== undefined)
	};
}

function judgeCondition(c: Condition, run: RunRecord, t: number): GoalState {
	const { canvas } = run;
	if ('node' in c) {
		const ok = matches(canvas, c.node.ref).some(({ config }) =>
			Object.entries(c.node.config ?? {}).every(([k, want]) => compare(config[k], want))
		);
		return ok ? 'met' : 'failed';
	}
	if ('edge' in c) {
		const from = matches(canvas, c.edge.from).map((node) => node.id);
		const to = matches(canvas, c.edge.to).map((node) => node.id);
		const ok = canvas.edges.some((e) => from.includes(e.source) && to.includes(e.target));
		return ok ? 'met' : 'failed';
	}
	return judgeMetric(c.metric, run, t);
}

function judgeMetric(metric: MetricCondition, run: RunRecord, t: number): GoalState {
	const [open, close] = windowOf(metric, run.length);
	if (t < open) return 'waiting';
	const { read, lte, gte } = metric;
	if (read === 'whole window' && t < close) return 'judging';
	// Datapoint by datapoint as the run plays, so a goal about a backlog fails where it broke
	const readings = matches(run.canvas, metric.node).map((node) =>
		metricReadings(run, node.id, metric, open, read === 'whole window' ? close : Math.min(t, close))
	);
	const holds = (value: number) => within(value, { lte, gte });
	const passes = (node: number[]) =>
		read === 'any datapoint' ? node.some(holds) : node.every(holds);
	// Every node the condition names, not just one of them: a name matches a single node, so this
	// only bites on a type, where one quiet node must not answer for the rest. A node that
	// recorded nothing proves nothing either way and is left out until the window closes on it
	const recording = readings.filter((node) => node.length > 0);
	const held = recording.length > 0 && recording.every(passes);
	if (read === 'any datapoint') {
		// Met the moment it has happened everywhere it was asked, rather than at the window's close
		if (held && recording.length === readings.length) return 'met';
		if (t < close) return 'judging';
		return held ? 'met' : 'failed';
	}
	if (held) return t < close ? 'judging' : 'met';
	// Silence so far may still become a reading; silence at the close has nothing to pass on
	return recording.length === 0 && t < close ? 'judging' : 'failed';
}

// The series a condition names: the ones carrying every dimension it gives, or every series
// where it names none, which is how a chart of the same metric groups an un-broken-down one
function seriesFor(store: MetricStore, name: string, dimensions: Dimensions = {}): MetricSeries[] {
	const wanted = Object.entries(dimensions);
	return Object.values(store[name] ?? {}).filter((series) =>
		wanted.every(([key, value]) => series.dimensions[key] === value)
	);
}

// One number for the window, or one for each datapoint in it. A datapoint the node recorded
// nothing in is no reading at all rather than a zero, so a gap never breaks a goal, but a
// window of nothing but gaps has nothing to pass on
function metricReadings(
	run: RunRecord,
	nodeId: string,
	metric: MetricCondition,
	from: number,
	to: number
): number[] {
	const series = seriesFor(run.metrics(nodeId), metric.name, metric.dimensions);
	if (series.length === 0 || to <= from) return [];
	const { lines } = breakDown(series, NO_BREAKDOWN);
	const ended = run.startedAt + to * 1000;
	const span = (to - from) * 1000;
	const rows =
		metric.read === 'whole window'
			? [metricTotals(lines, metric.statistic, ended, span)]
			: metricWindow(lines, metric.statistic, ended, span, PERIOD_MS);
	return rows.flatMap((row) => (row.all === null ? [] : [row.all]));
}

// The first that any condition is in wins, so a goal fails the moment one condition does
const PRECEDENCE: readonly GoalState[] = ['failed', 'judging', 'waiting'];

// Live as well as final
export function judge(challenge: Challenge, run: RunRecord, t: number): Record<string, GoalState> {
	const states: Record<string, GoalState> = {};
	for (const g of challenge.goals) {
		const parts = g.conditions.map((c) => judgeCondition(c, run, t));
		states[g.id] = PRECEDENCE.find((s) => parts.includes(s)) ?? 'met';
	}
	return states;
}
