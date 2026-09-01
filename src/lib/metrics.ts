// Aligned to absolute time rather than to a series' first sample, so series from different
// instances share bucket boundaries and aggregate by index
export const BASE_INTERVAL_MS = 1000;
export const MAX_BUCKETS = 900;

// Wider than the interval, so a reporter running a little late does not flicker to a dash
export const STALE_AFTER_MS = 5000;

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

// avg is the one that is derived rather than stored
export type MetricStatistic = keyof MetricBucket | 'avg';

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

// The current value is the newest interval, not a statistic over a window
export function latest(series: MetricSeries, now: number): MetricBucket | undefined {
	const last = series.buckets[series.buckets.length - 1];
	if (last.n === 0) return undefined;

	// A series that went quiet has no current value, rather than a minutes-old one shown as live
	const lastStart = series.start + (series.buckets.length - 1) * BASE_INTERVAL_MS;
	return now - lastStart <= STALE_AFTER_MS ? last : undefined;
}
