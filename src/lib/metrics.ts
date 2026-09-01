// Aligned to absolute time rather than to a series' first sample, so series from different
// instances share bucket boundaries and aggregate by index
export const BASE_INTERVAL_MS = 1000;
export const MAX_BUCKETS = 900;

export const METRIC_SENTINEL = 'gg:metric/1 ';

export type MetricBucket = {
	n: number;
	sum: number;
	min: number;
	max: number;
};

export type MetricSeries = {
	// Start of buckets[0]. Bucket i covers [start + i * BASE, start + (i + 1) * BASE)
	start: number;
	buckets: MetricBucket[];
};

// Listed as well as typed, so a picker cannot miss a field added to MetricBucket. avg is
// the one that is derived rather than stored
export const METRIC_STATISTICS = ['avg', 'n', 'sum', 'min', 'max'] as const;
export type MetricStatistic = (typeof METRIC_STATISTICS)[number];

export const CHART_READINGS = [...METRIC_STATISTICS, 'cumsum'] as const;
export type ChartReading = (typeof CHART_READINGS)[number];

// Sum rather than Total, which would suggest a running figure rather than one interval's
export const READING_TEXT: Record<ChartReading, string> = {
	avg: 'Average',
	n: 'Samples',
	sum: 'Sum',
	min: 'Lowest',
	max: 'Highest',
	cumsum: 'Running total'
};

export type MetricReport = { name: string; value: number };

export type ParsedLine = { ok: true; report: MetricReport } | { ok: false; reason: string };

export function bucketStart(time: number) {
	return Math.floor(time / BASE_INTERVAL_MS) * BASE_INTERVAL_MS;
}

// Zero is a placeholder in min and max: every read skips n === 0 rather than trusting them
function emptyBucket(): MetricBucket {
	return { n: 0, sum: 0, min: 0, max: 0 };
}

// Empty parts carry those placeholders, so they are skipped rather than folded in
function fold(target: MetricBucket, part: MetricBucket) {
	if (part.n === 0) return;
	target.min = target.n === 0 ? part.min : Math.min(target.min, part.min);
	target.max = target.n === 0 ? part.max : Math.max(target.max, part.max);
	target.n += part.n;
	target.sum += part.sum;
}

export function newSeries(time: number): MetricSeries {
	return { start: bucketStart(time), buckets: [emptyBucket()] };
}

// Grows to reach `time`, zero-filling the silence, then trims the front past capacity
function bucketFor(series: MetricSeries, time: number): MetricBucket {
	const wanted = (bucketStart(time) - series.start) / BASE_INTERVAL_MS;
	// Only a clock moving backwards produces this
	if (wanted < 0) return series.buckets[0];
	while (series.buckets.length <= wanted) series.buckets.push(emptyBucket());

	const over = series.buckets.length - MAX_BUCKETS;
	if (over <= 0) return series.buckets[wanted];
	series.buckets.splice(0, over);
	series.start += over * BASE_INTERVAL_MS;
	return series.buckets[wanted - over];
}

export function parseMetricLine(line: string): ParsedLine {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line.slice(METRIC_SENTINEL.length));
	} catch {
		return { ok: false, reason: 'not valid JSON' };
	}
	if (typeof parsed !== 'object' || parsed === null) {
		return { ok: false, reason: 'not a JSON object' };
	}

	// Unknown fields are ignored so a later addition cannot break an older reader
	const { name, value } = parsed as Record<string, unknown>;
	if (typeof name !== 'string' || name.length === 0) {
		return { ok: false, reason: 'missing a name' };
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return { ok: false, reason: 'value is not a finite number' };
	}
	return { ok: true, report: { name, value } };
}

export function record(series: MetricSeries, time: number, value: number) {
	fold(bucketFor(series, time), { n: 1, sum: value, min: value, max: value });
}

export function mergeBuckets(buckets: readonly MetricBucket[]): MetricBucket {
	const merged = emptyBucket();
	for (const bucket of buckets) fold(merged, bucket);
	return merged;
}

// undefined where the statistic describes nothing, so a caller shows a dash rather than a
// zero that would read as a measurement
export function statistic(bucket: MetricBucket, stat: MetricStatistic): number | undefined {
	if (stat === 'n') return bucket.n;
	if (stat === 'sum') return bucket.sum;
	if (bucket.n === 0) return undefined;
	return stat === 'avg' ? bucket.sum / bucket.n : bucket[stat];
}

// series is optional so an instance that has never reported this metric still holds its place
export type MetricLine = { port: number; series?: MetricSeries };
// instance port: metric value, plus the same reading across every line at once
export const ALL_LINES = 'all';
export type MetricWindowRow = { time: Date; all: number | null } & Record<number, number | null>;

// Rows sit on a fixed grid rather than being measured back from the clock, so a row keeps its
// value once the clock is past it. Anchored to `now`, every boundary slides a second at a time
// and samples fold into a different row on each tick, which shuffles the points sideways and
// opens and closes gaps in a line that has not changed
function windowEnd(now: number, gridMs: number) {
	return Math.floor(now / gridMs) * gridMs + gridMs;
}

// The stored buckets covering [from, to). Out-of-range ends just shorten the slice
function bucketsIn(series: MetricSeries, from: number, to: number): MetricBucket[] {
	const first = (bucketStart(from) - series.start) / BASE_INTERVAL_MS;
	const count = (to - from) / BASE_INTERVAL_MS;
	return series.buckets.slice(Math.max(0, first), Math.max(0, first + count));
}

// One row per interval, so every line is read at the same instant and a gap stays a gap.
// Anchored to the clock and always the full window, so the scale does not shift as samples
// land. Folding several base buckets into a row keeps a wide window readable. A fold of nothing
// counts zero but cannot be averaged, so counts run along the bottom where the rest leave a gap
export function metricWindow(
	lines: readonly MetricLine[],
	reading: ChartReading,
	now: number,
	windowMs: number,
	intervalMs: number = BASE_INTERVAL_MS,
	// The grid the window ends on, which is the row width unless a caller folds the whole
	// window into one point and still wants the span the chart beside it covers
	gridMs: number = intervalMs
): MetricWindowRow[] {
	// A running total accumulates each interval's sum, so that is what every row holds first
	const stat = reading === 'cumsum' ? 'sum' : reading;
	const end = windowEnd(now, gridMs);
	const rows: MetricWindowRow[] = [];
	const running: Record<number | string, number> = {};
	// Anchored to the left edge of the window rather than to the series
	const read = (key: number | typeof ALL_LINES, bucket: MetricBucket) => {
		const value = statistic(bucket, stat) ?? null;
		if (reading !== 'cumsum') return value;
		running[key] = (running[key] ?? 0) + (value ?? 0);
		return running[key];
	};

	for (let time = end - windowMs; time < end; time += intervalMs) {
		const row: MetricWindowRow = { time: new Date(time), all: null };
		const across: MetricBucket[] = [];
		for (const { port, series } of lines) {
			const merged = mergeBuckets(series ? bucketsIn(series, time, time + intervalMs) : []);
			across.push(merged);
			row[port] = read(port, merged);
		}
		// The same associative fold as over time, so the statistic keeps its meaning: a sum
		// totals the group, an average weights by sample count, min and max name an instance
		row.all = read(ALL_LINES, mergeBuckets(across));
		rows.push(row);
	}
	return rows;
}

// The window folded to a single point, for a readout beside the chart: the shape is what a
// chart shows well and a total is what it cannot be read for. One interval as wide as the
// window, so it is the same fold and cannot disagree with what is drawn
export function metricTotals(
	lines: readonly MetricLine[],
	reading: ChartReading,
	now: number,
	windowMs: number,
	intervalMs: number = BASE_INTERVAL_MS
): MetricWindowRow {
	return metricWindow(lines, reading, now, windowMs, windowMs, intervalMs)[0];
}
