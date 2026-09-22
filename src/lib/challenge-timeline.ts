import type { Challenge, Condition, DataCondition, Goal, NamedRef, ScriptEvent } from './challenge';

// Types only from `./challenge`, so the content site can import this module without pulling in
// zod, the resource definitions or anything else the app's schema reaches for

// The one node an event acts on, whichever kind it is
export function eventTarget(event: ScriptEvent): NamedRef {
	if ('start' in event) return event.start;
	if ('stop' in event) return event.stop;
	return event.set.node;
}

// The author's sentence where there is one: a setting's name is code vocabulary
export function eventSentence(event: ScriptEvent): string {
	if (event.text) return event.text;
	const who = eventTarget(event).name;
	if ('start' in event) return `${who} starts`;
	if ('stop' in event) return `${who} stops`;
	return `${who}'s settings change`;
}

// The second a read is taken, read by the judge, the runner and the panel alike
export function momentOf(c: DataCondition, length: number): number {
	return c.at ?? length;
}

// The stretch a `from`/`to` pair asks for, where either end left out means the run's own
export function windowOf(c: { from?: number; to?: number }, length: number): [number, number] {
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

// When each of a goal's conditions is judged
export function windowsOf(goal: Goal, length: number) {
	const windows = goal.conditions.map((c) => conditionWindow(c, length));
	return {
		atStart: windows.some((window) => window === undefined),
		judged: windows.filter((window) => window !== undefined)
	};
}

// A goal is judged over the union of its conditions' windows, so a covered one says nothing
export function mergeSpans(spans: [number, number][]): [number, number][] {
	const merged: [number, number][] = [];
	for (const [from, to] of spans.toSorted((a, b) => a[0] - b[0])) {
		const last = merged.at(-1);
		if (last && from <= last[1]) last[1] = Math.max(last[1], to);
		else merged.push([from, to]);
	}
	return merged;
}

const startOf = (goal: Goal, length: number) => {
	const { atStart, judged } = windowsOf(goal, length);
	return atStart ? 0 : Math.min(...judged.map(([from]) => from));
};

const endOf = (goal: Goal, length: number) =>
	Math.max(0, ...windowsOf(goal, length).judged.map(([, to]) => to));

// In the order they are judged, which is also the order the marks strip shows them, so the
// two views of one set of goals never disagree. Goals starting together go in the order they
// are decided, which lands ones sharing a window side by side to share a label
export function goalsInOrder({ goals, length }: Challenge): Goal[] {
	return goals.toSorted(
		(a, b) => startOf(a, length) - startOf(b, length) || endOf(a, length) - endOf(b, length)
	);
}

// One stretch of a run, in words. The one wording, so nothing showing a window has to invent
// its own
export function spanLabel([from, to]: [number, number], length: number): string {
	// A read is taken at a moment, where the two ends of its window meet
	if (from === to) return to >= length ? 'At the end' : `At ${from} s`;
	return to >= length ? `${from} s–end` : `${from}–${to} s`;
}

// When a goal is judged, in words: its merged windows, after the start where it has one
export function spanLabels(goal: Goal, length: number): string[] {
	const { atStart, judged } = windowsOf(goal, length);
	const spans = mergeSpans(judged).map((span) => spanLabel(span, length));
	// Not "0 s", which on an event row means something that happens then
	return atStart ? ['At the start', ...spans] : spans;
}

export type Row = { at: number; time: string } & (
	{ event: ScriptEvent; goal?: undefined } | { goal: Goal; event?: undefined }
);

// One list in run order, so the reader never matches times across two lists
export function timelineRows(challenge: Challenge): Row[] {
	const { events, length } = challenge;
	const eventRows: Row[] = events.map((event) => ({
		at: event.at,
		time: `${event.at} s`,
		event
	}));
	const goalRows: Row[] = goalsInOrder(challenge).map((goal) => ({
		at: startOf(goal, length),
		time: spanLabels(goal, length).join(', '),
		goal
	}));
	// Sorting is stable and the events went in first, so they keep their place within a second
	const rows = [...eventRows, ...goalRows].sort((a, b) => a.at - b.at);
	// One label covers rows sharing a time, and only an exact repeat: a longer span says more
	return rows.map((row, i) => (row.time === rows[i - 1]?.time ? { ...row, time: '' } : row));
}

// Every stretch any goal is judged over, once each, shaded on the bar. A moment shades
// nothing, since a zero-width band would be a line the bar already has for events
export function shadedSpans({ goals, length }: Challenge): [number, number][] {
	const spans = goals
		.flatMap((goal) => windowsOf(goal, length).judged)
		.filter(([from, to]) => from !== to);
	return [...new Map(spans.map((span) => [`${span[0]}-${span[1]}`, span])).values()];
}
