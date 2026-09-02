// CloudWatch's period: one datapoint per second, aligned to absolute time rather than to a
// series' first sample, so series from different instances share boundaries and aggregate by
// index
export const PERIOD_MS = 1000;
export const MAX_DATAPOINTS = 900;

// One datapoint, as CloudWatch stores one: not the observations but their summary
export type StatisticSet = {
	sampleCount: number;
	sum: number;
	minimum: number;
	maximum: number;
};

export type MetricSeries = {
	// Start of datapoints[0]. Datapoint i covers [start + i * PERIOD, start + (i + 1) * PERIOD)
	start: number;
	datapoints: StatisticSet[];
	// As CloudWatch names them: Count, Milliseconds, Bytes. Fixed by the first report
	unit?: string;
};

// CloudWatch's five statistics, named as its API names them. Listed as well as typed, so a
// picker cannot miss one; Average is the one derived rather than stored
export const METRIC_STATISTICS = ['Average', 'SampleCount', 'Sum', 'Minimum', 'Maximum'] as const;
export type MetricStatistic = (typeof METRIC_STATISTICS)[number];

// Plus metric math's RUNNING_SUM, which a chart wants and a datapoint cannot hold
export const CHART_READINGS = [...METRIC_STATISTICS, 'RunningSum'] as const;
export type ChartReading = (typeof CHART_READINGS)[number];

export const READING_TEXT: Record<ChartReading, string> = {
	Average: 'Average',
	SampleCount: 'Sample count',
	Sum: 'Sum',
	Minimum: 'Minimum',
	Maximum: 'Maximum',
	RunningSum: 'Running sum'
};

export type MetricDatum = { name: string; value: number; unit?: string };

export type ParsedLine = { ok: true; data: MetricDatum[] } | { ok: false; reason: string };

// Cheap enough to run on every captured line, so ordinary JSON output is never parsed twice
export function looksLikeEmf(line: string) {
	return line.startsWith('{') && line.includes('"_aws"');
}

// A count sums and a measurement averages: the average of a count reported as 1 per event
// is 1 by construction, which draws a flat line
export function defaultStatisticFor(unit: string | undefined): MetricStatistic {
	return unit === undefined || unit === 'Count' || unit === 'None' ? 'Sum' : 'Average';
}

export function periodStart(time: number) {
	return Math.floor(time / PERIOD_MS) * PERIOD_MS;
}

// Zero is a placeholder in minimum and maximum: every read skips sampleCount === 0 rather
// than trusting them
function emptySet(): StatisticSet {
	return { sampleCount: 0, sum: 0, minimum: 0, maximum: 0 };
}

// Empty parts carry those placeholders, so they are skipped rather than folded in
function fold(target: StatisticSet, part: StatisticSet) {
	if (part.sampleCount === 0) return;
	target.minimum = target.sampleCount === 0 ? part.minimum : Math.min(target.minimum, part.minimum);
	target.maximum = target.sampleCount === 0 ? part.maximum : Math.max(target.maximum, part.maximum);
	target.sampleCount += part.sampleCount;
	target.sum += part.sum;
}

export function newSeries(time: number, unit?: string): MetricSeries {
	return { start: periodStart(time), datapoints: [emptySet()], unit };
}

// Grows to reach `time`, zero-filling the silence, then trims the front past capacity
function datapointFor(series: MetricSeries, time: number): StatisticSet {
	const wanted = (periodStart(time) - series.start) / PERIOD_MS;
	// Only a clock moving backwards produces this
	if (wanted < 0) return series.datapoints[0];
	while (series.datapoints.length <= wanted) series.datapoints.push(emptySet());

	const over = series.datapoints.length - MAX_DATAPOINTS;
	if (over <= 0) return series.datapoints[wanted];
	series.datapoints.splice(0, over);
	series.start += over * PERIOD_MS;
	return series.datapoints[wanted - over];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

// The Embedded Metric Format: a JSON line whose _aws block declares which top-level fields
// are metrics. Real CloudWatch extracts these from a log stream; here the reader does it.
// A metric declared under several dimension sets is one series, so it is read once
export function parseEmfLine(line: string): ParsedLine {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return { ok: false, reason: 'not valid JSON' };
	}
	if (!isRecord(parsed) || !isRecord(parsed._aws)) {
		return { ok: false, reason: 'missing the _aws block' };
	}
	const blocks = parsed._aws.CloudWatchMetrics;
	if (!Array.isArray(blocks) || blocks.length === 0) {
		return { ok: false, reason: 'missing CloudWatchMetrics' };
	}

	const data: MetricDatum[] = [];
	const seen = new Set<string>();
	for (const block of blocks) {
		if (!isRecord(block) || !Array.isArray(block.Metrics)) {
			return { ok: false, reason: 'missing Metrics in a CloudWatchMetrics block' };
		}
		for (const metric of block.Metrics) {
			if (!isRecord(metric) || typeof metric.Name !== 'string' || metric.Name.length === 0) {
				return { ok: false, reason: 'a metric has no Name' };
			}
			if (seen.has(metric.Name)) continue;
			seen.add(metric.Name);
			const unit = typeof metric.Unit === 'string' ? metric.Unit : undefined;
			const raw = parsed[metric.Name];
			const values = Array.isArray(raw) ? raw : [raw];
			for (const value of values) {
				if (typeof value !== 'number' || !Number.isFinite(value)) {
					return { ok: false, reason: `${metric.Name} is not a finite number` };
				}
				data.push({ name: metric.Name, value, unit });
			}
		}
	}
	return { ok: true, data };
}

export function record(series: MetricSeries, time: number, value: number) {
	fold(datapointFor(series, time), { sampleCount: 1, sum: value, minimum: value, maximum: value });
}

export function mergeStatistics(sets: readonly StatisticSet[]): StatisticSet {
	const merged = emptySet();
	for (const set of sets) fold(merged, set);
	return merged;
}

// undefined where the statistic describes nothing, so a caller shows a dash rather than a
// zero that would read as a measurement
export function statistic(set: StatisticSet, stat: MetricStatistic): number | undefined {
	if (stat === 'SampleCount') return set.sampleCount;
	if (stat === 'Sum') return set.sum;
	if (set.sampleCount === 0) return undefined;
	if (stat === 'Average') return set.sum / set.sampleCount;
	return stat === 'Minimum' ? set.minimum : set.maximum;
}

// An instance, named by its port, or the node itself: the region reports what a resource
// holds for the whole node, with no process behind it
export type MetricSource = number | 'resource';
// series is optional so an instance that has never reported this metric still holds its place
export type MetricLine = { port: MetricSource; series?: MetricSeries };

// Whichever line carries one: a unit is fixed per name, so the first is as good as any
export const unitOf = (lines: readonly MetricLine[]) =>
	lines.find((line) => line.series?.unit)?.series?.unit;
// source: metric value, plus the same reading across every line at once
export const ALL_LINES = 'all';
export type MetricWindowRow = { time: Date; all: number | null } & Partial<
	Record<MetricSource, number | null>
>;

// Rows sit on a fixed grid rather than being measured back from the clock, so a row keeps its
// value once the clock is past it. Anchored to `now`, every boundary slides a second at a time
// and samples fold into a different row on each tick, which shuffles the points sideways and
// opens and closes gaps in a line that has not changed
function windowEnd(now: number, gridMs: number) {
	return Math.floor(now / gridMs) * gridMs + gridMs;
}

// The stored datapoints covering [from, to). Out-of-range ends just shorten the slice
function datapointsIn(series: MetricSeries, from: number, to: number): StatisticSet[] {
	const first = (periodStart(from) - series.start) / PERIOD_MS;
	const count = (to - from) / PERIOD_MS;
	return series.datapoints.slice(Math.max(0, first), Math.max(0, first + count));
}

// One row per interval, so every line is read at the same instant and a gap stays a gap.
// Anchored to the clock and always the full window, so the scale does not shift as samples
// land. Folding several base periods into a row keeps a wide window readable. A fold of nothing
// counts zero but cannot be averaged, so counts run along the bottom where the rest leave a gap
export function metricWindow(
	lines: readonly MetricLine[],
	reading: ChartReading,
	now: number,
	windowMs: number,
	intervalMs: number = PERIOD_MS,
	// The grid the window ends on, which is the row width unless a caller folds the whole
	// window into one point and still wants the span the chart beside it covers
	gridMs: number = intervalMs
): MetricWindowRow[] {
	// A running sum accumulates each period's sum, so that is what every row holds first
	const stat = reading === 'RunningSum' ? 'Sum' : reading;
	const end = windowEnd(now, gridMs);
	const rows: MetricWindowRow[] = [];
	const running: Record<MetricSource | string, number> = {};
	// Anchored to the left edge of the window rather than to the series
	const read = (key: MetricSource | typeof ALL_LINES, set: StatisticSet) => {
		const value = statistic(set, stat) ?? null;
		if (reading !== 'RunningSum') return value;
		running[key] = (running[key] ?? 0) + (value ?? 0);
		return running[key];
	};

	for (let time = end - windowMs; time < end; time += intervalMs) {
		const row: MetricWindowRow = { time: new Date(time), all: null };
		const across: StatisticSet[] = [];
		for (const { port, series } of lines) {
			const merged = mergeStatistics(series ? datapointsIn(series, time, time + intervalMs) : []);
			across.push(merged);
			row[port] = read(port, merged);
		}
		// The same associative fold as over time, so the statistic keeps its meaning: a sum
		// totals the group, an average weights by sample count, minimum and maximum name an instance
		row.all = read(ALL_LINES, mergeStatistics(across));
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
	intervalMs: number = PERIOD_MS
): MetricWindowRow {
	return metricWindow(lines, reading, now, windowMs, windowMs, intervalMs)[0];
}
