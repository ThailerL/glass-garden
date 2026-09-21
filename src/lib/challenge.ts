import { z } from 'zod';
import { readOf, readsOf, resourceTypeSchema } from './resources';
import { scalar, type Scalar } from './resources/types';
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
		eq: scalar.optional(),
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

// What a metric condition is judged over: the window as one number, or each datapoint in it
const metricOver = z.enum(['whole window', 'every datapoint', 'any datapoint']);

// Any metric a node records, read the way the metrics tab reads it, so a goal and a chart
// of the same metric can never disagree. `over` is whether the window folds into one number
// or is judged datapoint by datapoint, each one a second of the run as the store keeps it
const metricCondition = z
	.strictObject({
		node: nodeRef,
		name: z.string().min(1),
		dimensions: z.record(z.string(), z.string()).optional(),
		statistic: z.enum(METRIC_STATISTICS),
		over: metricOver.default('whole window'),
		// Seconds folded into one reading, as a CloudWatch alarm's period is
		period: z.number().int().positive().optional(),
		// Seconds from the moment every node reports running; a window given no end runs
		// to the end of the challenge
		from: z.number().min(0).optional(),
		to: z.number().positive().optional(),
		lte: z.number().optional(),
		gte: z.number().optional()
	})
	.refine((m) => m.lte !== undefined || m.gte !== undefined, {
		error: 'A metric condition needs lte, gte, or both'
	})
	.refine((m) => m.period === undefined || m.over !== 'whole window', {
		error: 'A period needs a datapoint read, since a whole window is already one reading'
	});
export type MetricCondition = z.infer<typeof metricCondition>;

// What a resource holds, through a read its own definition declares. Exported so the conversion
// to JSON Schema can find this condition and enumerate the reads a string cannot name
export const dataCondition = z
	.strictObject({
		node: nodeRef,
		read: z.string().min(1),
		// Checked by the read's own schema, not here
		args: z.record(z.string(), z.unknown()).default({}),
		// The second of the run it is read at; the run's end if omitted
		at: z.number().min(0).optional(),
		// Empty asks only that there is something there
		has: z.record(z.string(), comparison).default({})
	})
	// A named node is checked by the document instead, which has the canvas
	.superRefine((c, ctx) => {
		if (!('type' in c.node)) return;
		const message = readProblem(c.node.type, c);
		if (message) ctx.addIssue({ code: 'custom', message });
	});
export type DataCondition = z.infer<typeof dataCondition>;

// Shared so a named node and a supplied one are held to one rule
export function readProblem(type: string, c: DataCondition): string | undefined {
	const read = readOf(type, c.read);
	if (!read) {
		const offered = readsOf(type).map((one) => `"${one}"`);
		const names = offered.length === 0 ? 'none' : offered.join(', ');
		return `"${c.read}" is not a read a ${type} offers, which has ${names}`;
	}
	const parsed = read.args.safeParse(c.args);
	if (!parsed.success) {
		return `"${c.read}" cannot use those arguments: ${z.prettifyError(parsed.error)}`;
	}
}

// Declarative only: a challenge arrives in a share link, which is anyone's text. Every object
// is strict, since hand-editing is the only way to author one and a key the schema ignored
// would leave a goal quietly meaning something other than what it says
const condition = z.union([
	z.strictObject({
		node: nodeRef,
		config: z.record(z.string(), comparison).optional()
	}),
	z.strictObject({ edge: z.strictObject({ from: nodeRef, to: nodeRef }) }),
	z.strictObject({ metric: metricCondition }),
	z.strictObject({ data: dataCondition })
]);
export type Condition = z.infer<typeof condition>;
export type ConditionInput = z.input<typeof condition>;

// Every condition has to hold for the goal to be met
const goal = z.strictObject({
	// What a run is scored by and what an embedding page is told, so it outlives a reworded title
	id: z.string().min(1),
	title: z.string().min(1),
	hint: z.string().min(1).optional(),
	conditions: z.array(condition).min(1)
});
export type Goal = z.infer<typeof goal>;

const goals = z
	.array(goal)
	.min(1, { error: 'A challenge needs a goal' })
	.superRefine((all, ctx) => {
		const seen = new Set<string>();
		for (const { id } of all) {
			if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `Two goals share the id "${id}"` });
			seen.add(id);
		}
	});

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
		// Bounded here rather than in the refinement below so the generated JSON Schema carries the
		// maximum, and an author's editor says so before the file is imported
		length: z
			.number()
			.positive()
			.max(MAX_RUN_SECONDS, {
				error: `A challenge runs for at most ${MAX_RUN_SECONDS} s, which is as much of a metric as a node keeps, and its goals are scored at the end`
			}),
		events: z.array(scriptEvent).default([]),
		fixed: z.array(fixedNode).default([]),
		goals
	})
	// What the run's length leaves room for, which no single value can say
	.superRefine(({ length, events, goals }, ctx) => {
		const problem = (message: string) => ctx.addIssue({ code: 'custom', message });
		for (const goal of goals) {
			for (const condition of goal.conditions) {
				// A moment rather than a stretch, so it is only ever past the run's end
				if ('data' in condition) {
					const at = momentOf(condition.data, length);
					if (at > length) {
						problem(
							`The goal "${goal.title}" is read at ${at} s, after the challenge's ${length} s end`
						);
					}
					continue;
				}
				const window = conditionWindow(condition, length);
				if (!window) continue;
				const [open, close] = window;
				// A stretch has to close after it opens, and nothing can be judged past the run's end
				if (!(open < close && close <= length)) {
					problem(
						`The goal "${goal.title}" is judged from ${open} s to ${close} s, which must end after it starts and by the challenge's length of ${length} s`
					);
					continue;
				}
				// A part-finished period is never judged, so one left over is a stretch nothing reads
				const period = 'metric' in condition ? condition.metric.period : undefined;
				if (period === undefined || (close - open) % period === 0) continue;
				problem(
					`The goal "${goal.title}" is judged from ${open} s to ${close} s in periods of ${period} s, which has to divide the ${close - open} s between them`
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
	// From the fixed list, which describes a node rather than depending on it
	fixed?: boolean;
	data?: DataCondition;
};

export function* challengeRefs(challenge: Challenge): Generator<ChallengeRef> {
	for (const goal of challenge.goals) {
		const where = `The goal "${goal.title}"`;
		for (const c of goal.conditions) {
			if ('node' in c) yield { where, ref: c.node, config: c.config };
			else if ('edge' in c) yield* [c.edge.from, c.edge.to].map((ref) => ({ where, ref }));
			else if ('data' in c) yield { where, ref: c.data.node, data: c.data };
			else yield { where, ref: c.metric.node };
		}
	}
	for (const event of challenge.events) {
		yield { where: `The event at ${event.at} s`, ref: eventTarget(event) };
	}
	for (const { node } of challenge.fixed) {
		yield { where: `The settings fixed on "${node.name}"`, ref: node, fixed: true };
	}
}

// The nodes a run cannot do without, by name
export function neededNodes(challenge: Challenge): Set<string> {
	const names = new Set<string>();
	for (const { fixed, ref } of challengeRefs(challenge)) {
		if (!fixed && 'name' in ref) names.add(ref.name);
	}
	return names;
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
	// A rename would detach every goal, event and fixed entry naming this node, all at once, so
	// only a node nothing names is the reader's to rename
	if (!fixed) {
		return neededNodes(challenge).has(node.name) ? (setting) => setting === 'name' : NOTHING_FIXED;
	}
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

// One owner for the denominator an embedding page is told
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
// found undefined is a read that found nothing; no Reading at all is one that has not run
export type Reading = { found?: Record<string, Scalar> };

export type RunRecord = {
	length: number;
	canvas: CanvasView;
	startedAt: number;
	metrics: (nodeId: string) => MetricStore;
	readings: (nodeId: string, c: DataCondition) => Reading | undefined;
};

export function dataConditions(challenge: Challenge): DataCondition[] {
	return challenge.goals.flatMap((goal) =>
		goal.conditions.flatMap((c) => ('data' in c ? [c.data] : []))
	);
}

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

// The stretch a condition is judged over, a moment where the two ends meet, or nothing for one
// checked as the run starts. One rule, so the judge, the document's checks and the panel's
// timeline cannot come to disagree
export function conditionWindow(c: Condition, length: number): [number, number] | undefined {
	if ('metric' in c) return windowOf(c.metric, length);
	if (!('data' in c)) return undefined;
	const at = momentOf(c.data, length);
	return [at, at];
}

// The second a read is taken, read by the judge, the runner and the panel alike
export function momentOf(c: DataCondition, length: number): number {
	return c.at ?? length;
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
		const ok = matches(canvas, c.node).some(({ config }) =>
			Object.entries(c.config ?? {}).every(([k, want]) => compare(config[k], want))
		);
		return ok ? 'met' : 'failed';
	}
	if ('edge' in c) {
		const from = matches(canvas, c.edge.from).map((node) => node.id);
		const to = matches(canvas, c.edge.to).map((node) => node.id);
		const ok = canvas.edges.some((e) => from.includes(e.source) && to.includes(e.target));
		return ok ? 'met' : 'failed';
	}
	if ('data' in c) return judgeData(c.data, run, t);
	return judgeMetric(c.metric, run, t);
}

function judgeData(c: DataCondition, run: RunRecord, t: number): GoalState {
	if (t < momentOf(c, run.length)) return 'waiting';
	const nodes = matches(run.canvas, c.node);
	// Nothing to read, which no comparison can be true of
	if (nodes.length === 0) return 'failed';
	const wanted = Object.entries(c.has);
	let state: GoalState = 'met';
	for (const node of nodes) {
		const reading = run.readings(node.id, c);
		if (!reading) return 'judging';
		const { found } = reading;
		if (!found || !wanted.every(([key, want]) => compare(found[key], want))) state = 'failed';
	}
	return state;
}

function judgeMetric(metric: MetricCondition, run: RunRecord, t: number): GoalState {
	const [open, close] = windowOf(metric, run.length);
	if (t < open) return 'waiting';
	const { over, lte, gte } = metric;
	if (over === 'whole window' && t < close) return 'judging';
	// Datapoint by datapoint as the run plays, so a goal about a backlog fails where it broke
	const readings = matches(run.canvas, metric.node).map((node) =>
		metricReadings(run, node.id, metric, open, over === 'whole window' ? close : Math.min(t, close))
	);
	const holds = (value: number) => within(value, { lte, gte });
	const passes = (node: number[]) =>
		over === 'any datapoint' ? node.some(holds) : node.every(holds);
	// Every node the condition names, not just one of them: a name matches a single node, so this
	// only bites on a type, where one quiet node must not answer for the rest. A node that
	// recorded nothing proves nothing either way and is left out until the window closes on it
	const recording = readings.filter((node) => node.length > 0);
	const held = recording.length > 0 && recording.every(passes);
	if (over === 'any datapoint') {
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
	const period = metric.period ?? 1;
	// Whole periods only, so one still filling cannot fail a goal before it is over
	const read = period === 1 ? to : from + Math.floor((to - from) / period) * period;
	if (series.length === 0 || read <= from) return [];
	const { lines } = breakDown(series, NO_BREAKDOWN);
	const ended = run.startedAt + read * 1000;
	const span = (read - from) * 1000;
	const rows =
		metric.over === 'whole window'
			? [metricTotals(lines, metric.statistic, ended, span)]
			: // Rows as wide as the period, on the base grid, so they tile the window itself
				metricWindow(lines, metric.statistic, ended, span, period * 1000, PERIOD_MS);
	return rows.flatMap((row) => (row.all === null ? [] : [row.all]));
}

// The first that any condition is in wins, so a goal fails the moment one condition does
const PRECEDENCE: readonly GoalState[] = ['failed', 'judging', 'waiting'];

// Live as well as final
export function judge(challenge: Challenge, run: RunRecord, t: number): Record<string, GoalState> {
	const states: Record<string, GoalState> = {};
	for (const goal of challenge.goals) {
		const parts = goal.conditions.map((c) => judgeCondition(c, run, t));
		states[goal.id] = PRECEDENCE.find((s) => parts.includes(s)) ?? 'met';
	}
	return states;
}
