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

// A goal settled as the run starts is a moment at zero: it sorts to the front, shades nothing
const spanOf = (goal: Goal, length: number): [number, number] => goalSpan(goal, length) ?? [0, 0];

// In the order they are judged, which is also the order the marks strip shows them, so the
// two views of one set of goals never disagree. Goals starting together go in the order they
// are decided, which lands ones sharing a window side by side to share a label
export function goalsInOrder({ goals, length }: Challenge): Goal[] {
	return goals.toSorted(
		(a, b) =>
			spanOf(a, length)[0] - spanOf(b, length)[0] || spanOf(a, length)[1] - spanOf(b, length)[1]
	);
}

// One stretch of a run, in words. The one wording, so nothing showing a window has to invent
// its own
// A second of a run, in words, for a sentence to lead with. The clock stops at the run's own
// length, so the last of them is the end rather than a number
export function momentWords(at: number, length: number): string {
	return at >= length ? 'the end' : `${at} s`;
}

export function spanLabel([from, to]: [number, number], length: number): string {
	// A read is taken at a moment, where the two ends of its window meet
	if (from === to) return `At ${momentWords(to, length)}`;
	return to >= length ? `${from} s–end` : `${from}–${to} s`;
}

// From a goal's first window to its last, or nothing for one the canvas already answers. A gap
// between two of its windows says nothing the reader can act on, so it is not drawn as one
export function goalSpan(goal: Goal, length: number): [number, number] | undefined {
	const windows = goal.conditions
		.map((c) => conditionWindow(c, length))
		.filter((window) => window !== undefined);
	if (windows.length === 0) return undefined;
	return [Math.min(...windows.map(([from]) => from)), Math.max(...windows.map(([, to]) => to))];
}

// When a goal is judged, in words
export function goalSpanLabel(goal: Goal, length: number): string {
	const span = goalSpan(goal, length);
	// Not "0 s", which on an event row means something that happens then
	return span ? spanLabel(span, length) : 'At the start';
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
		at: spanOf(goal, length)[0],
		time: goalSpanLabel(goal, length),
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
	const spans = goals.map((goal) => spanOf(goal, length)).filter(([from, to]) => from !== to);
	return [...new Map(spans.map((span) => [`${span[0]}-${span[1]}`, span])).values()];
}
