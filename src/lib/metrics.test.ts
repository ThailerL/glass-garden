import { describe, it, expect } from 'vitest';
import {
	BASE_INTERVAL_MS,
	MAX_BUCKETS,
	METRIC_SENTINEL,
	CHART_READINGS,
	METRIC_STATISTICS,
	READING_TEXT,
	mergeBuckets,
	metricTotals,
	metricWindow,
	newSeries,
	parseMetricLine,
	record,
	statistic,
	type MetricStatistic
} from './metrics';

// Divisible by BASE_INTERVAL_MS, so it is itself the start of a bucket
const t0 = 1_700_000_000_000;

const line = (body: unknown) => `${METRIC_SENTINEL}${JSON.stringify(body)}`;

describe('parseMetricLine', () => {
	it('reads a name and a value', () => {
		expect(parseMetricLine(line({ name: 'requests', value: 7 }))).toEqual({
			ok: true,
			report: { name: 'requests', value: 7 }
		});
	});

	it('ignores fields it does not know, so a later addition cannot break it', () => {
		expect(parseMetricLine(line({ name: 'latency', value: 3, kind: 'gauge', unit: 'ms' }))).toEqual(
			{ ok: true, report: { name: 'latency', value: 3 } }
		);
	});

	it.each([
		['not JSON at all', `${METRIC_SENTINEL}{oh dear`],
		['JSON that is not an object', line(42)],
		['a missing name', line({ value: 1 })],
		['an empty name', line({ name: '', value: 1 })],
		['a missing value', line({ name: 'requests' })],
		['a value that is not a number', line({ name: 'requests', value: 'lots' })],
		['a value that is not finite', line({ name: 'requests', value: null })]
	])('refuses %s', (_reason, text) => {
		expect(parseMetricLine(text).ok).toBe(false);
	});
});

describe('record', () => {
	it('folds everything in one interval into one bucket', () => {
		const series = newSeries(t0);
		for (const value of [3, 9, 5]) record(series, t0 + 100, value);

		expect(series.buckets).toEqual([{ n: 3, sum: 17, min: 3, max: 9 }]);
	});

	it('keeps intervals apart and zero-fills the silence between them', () => {
		const series = newSeries(t0);
		record(series, t0, 1);
		record(series, t0 + 3 * BASE_INTERVAL_MS, 4);

		expect(series.buckets).toHaveLength(4);
		expect(series.buckets[0]).toEqual({ n: 1, sum: 1, min: 1, max: 1 });
		expect(series.buckets.slice(1, 3).every((bucket) => bucket.n === 0)).toBe(true);
		expect(series.buckets[3]).toEqual({ n: 1, sum: 4, min: 4, max: 4 });
	});

	it('drops the oldest buckets past capacity and moves start to match', () => {
		const series = newSeries(t0);
		record(series, t0, 1);
		record(series, t0 + MAX_BUCKETS * BASE_INTERVAL_MS, 2);

		expect(series.buckets).toHaveLength(MAX_BUCKETS);
		expect(series.start).toBe(t0 + BASE_INTERVAL_MS);
		// The newest observation is still the newest bucket after the trim
		expect(series.buckets[MAX_BUCKETS - 1]).toEqual({ n: 1, sum: 2, min: 2, max: 2 });
	});
});

describe('mergeBuckets', () => {
	// The property that lets a line be emitted per event or pre-folded without the reader
	// being able to tell, so neither path is second class
	it('matches folding the same observations into a single bucket', () => {
		const spread = newSeries(t0);
		record(spread, t0, 3);
		record(spread, t0, 9);
		record(spread, t0 + BASE_INTERVAL_MS, 5);
		record(spread, t0 + 2 * BASE_INTERVAL_MS, 7);

		const together = newSeries(t0);
		for (const value of [3, 9, 5, 7]) record(together, t0, value);

		expect(mergeBuckets(spread.buckets)).toEqual(together.buckets[0]);
	});

	it('is unaffected by the silent intervals it spans', () => {
		const quiet = newSeries(t0);
		record(quiet, t0, 6);
		record(quiet, t0 + 5 * BASE_INTERVAL_MS, 2);

		const dense = newSeries(t0);
		record(dense, t0, 6);
		record(dense, t0 + BASE_INTERVAL_MS, 2);

		expect(mergeBuckets(quiet.buckets)).toEqual(mergeBuckets(dense.buckets));
	});

	it('describes nothing when every bucket is empty', () => {
		const series = newSeries(t0);
		record(series, t0 + 2 * BASE_INTERVAL_MS, 1);

		expect(mergeBuckets(series.buckets.slice(0, 2))).toEqual({ n: 0, sum: 0, min: 0, max: 0 });
	});
});

describe('statistic', () => {
	it('reads each one off a merged bucket', () => {
		const series = newSeries(t0);
		for (const value of [2, 4, 6]) record(series, t0, value);
		const bucket = mergeBuckets(series.buckets);

		expect(statistic(bucket, 'n')).toBe(3);
		expect(statistic(bucket, 'sum')).toBe(12);
		expect(statistic(bucket, 'avg')).toBe(4);
		expect(statistic(bucket, 'min')).toBe(2);
		expect(statistic(bucket, 'max')).toBe(6);
	});

	// A dash rather than a zero the reader would take for a measurement
	it('has no answer but a count for an interval nothing landed in', () => {
		const empty = mergeBuckets([]);

		expect(statistic(empty, 'n')).toBe(0);
		expect(statistic(empty, 'avg')).toBeUndefined();
		expect(statistic(empty, 'min')).toBeUndefined();
		expect(statistic(empty, 'max')).toBeUndefined();
	});
});

describe('METRIC_STATISTICS', () => {
	// The picker is built from this list, so a missing field is unreachable
	it('offers every stored field, and avg', () => {
		const stored = Object.keys(newSeries(t0).buckets[0]);
		expect([...METRIC_STATISTICS].sort()).toEqual([...stored, 'avg'].sort());
	});

	// The picker reads from CHART_READINGS, so anything only in the statistics is unreachable
	it('is offered in full by the chart readings, which add a running total', () => {
		expect(CHART_READINGS).toEqual([...METRIC_STATISTICS, 'cumsum']);
		expect(Object.keys(READING_TEXT).sort()).toEqual([...CHART_READINGS].sort());
	});
});

describe('metricWindow', () => {
	const port = 3000;
	// The window ends at the bucket after `now`, so this is its last column
	const now = t0 + 5 * BASE_INTERVAL_MS;
	const windowMs = 4 * BASE_INTERVAL_MS;

	function column(rows: ReturnType<typeof metricWindow>, offset: number) {
		return rows.find((row) => row.time.getTime() === now + offset * BASE_INTERVAL_MS)?.[port];
	}

	it('spans the full window whatever the series holds', () => {
		const series = newSeries(now);
		const rows = metricWindow([{ port, series }], 'sum', now, windowMs);

		expect(rows).toHaveLength(4);
		expect(rows[0].time.getTime()).toBe(now - 3 * BASE_INTERVAL_MS);
		expect(rows[3].time.getTime()).toBe(now);
	});

	it('reads every line at the same instant, and keeps one line short of another', () => {
		const early = newSeries(now - 3 * BASE_INTERVAL_MS);
		record(early, now - 3 * BASE_INTERVAL_MS, 4);
		const late = newSeries(now);
		record(late, now, 9);

		const rows = metricWindow(
			[
				{ port: 3000, series: early },
				{ port: 3001, series: late }
			],
			'sum',
			now,
			windowMs
		);

		expect(rows[0][3000]).toBe(4);
		// It had counted nothing yet, which is zero rather than unknown
		expect(rows[0][3001]).toBe(0);
		expect(rows[3][3000]).toBe(0);
		expect(rows[3][3001]).toBe(9);
	});

	// Otherwise an instance that has served nothing reads differently from one that has been
	// idle a minute, though both counted nothing just now
	it('counts zero for a line that has never reported', () => {
		const rows = metricWindow([{ port }], 'sum', now, windowMs);

		expect(rows).toHaveLength(4);
		expect(rows.every((row) => row[port] === 0)).toBe(true);
	});

	// The fold is associative, so a coarser interval must give the same answer over fewer
	// points, not a different one
	it('folds several base intervals into one point without changing the answer', () => {
		// Read at the end of a grid interval, so the single wide row is the one holding them
		const last = t0 + 3 * BASE_INTERVAL_MS;
		const series = newSeries(t0);
		for (const [offset, value] of [
			[0, 2],
			[1, 6],
			[2, 4],
			[3, 8]
		]) {
			record(series, t0 + offset * BASE_INTERVAL_MS, value);
		}
		const coarse = (stat: MetricStatistic) =>
			metricWindow([{ port, series }], stat, last, windowMs, windowMs)[0][port];

		expect(coarse('n')).toBe(4);
		expect(coarse('sum')).toBe(20);
		expect(coarse('avg')).toBe(5);
		expect(coarse('min')).toBe(2);
		expect(coarse('max')).toBe(8);
	});

	// The figure the default app's page used to print, which nothing else answers now
	it('accumulates a running total across the window', () => {
		const series = newSeries(now - 3 * BASE_INTERVAL_MS);
		record(series, now - 3 * BASE_INTERVAL_MS, 2);
		record(series, now - BASE_INTERVAL_MS, 3);
		record(series, now, 5);

		const rows = metricWindow([{ port, series }], 'cumsum', now, windowMs);

		// Climbs and never falls, holding its level through the silent interval
		expect(rows.map((row) => row[port])).toEqual([2, 2, 5, 10]);
	});

	// Anchored to the range shown, so it answers "how many over this window" rather than
	// "how many ever"
	it('starts the running total again at the left edge of a shorter window', () => {
		const series = newSeries(now - 3 * BASE_INTERVAL_MS);
		record(series, now - 3 * BASE_INTERVAL_MS, 2);
		record(series, now, 5);

		const narrow = metricWindow([{ port, series }], 'cumsum', now, 2 * BASE_INTERVAL_MS);

		expect(narrow.map((row) => row[port])).toEqual([0, 5]);
	});

	it('totals every line for a sum', () => {
		const one = newSeries(now);
		record(one, now, 4);
		const two = newSeries(now);
		for (const value of [3, 5]) record(two, now, value);

		const rows = metricWindow(
			[{ port: 3000, series: one }, { port: 3001, series: two }, { port: 3002 }],
			'sum',
			now,
			windowMs
		);

		expect(rows[3].all).toBe(12);
	});

	// Weighted by how many observations each line contributed, which the average of their
	// averages ((4 + 10) / 2 = 7) would not be
	it('averages every line by sample count rather than by line', () => {
		const one = newSeries(now);
		record(one, now, 4);
		const two = newSeries(now);
		for (const value of [8, 12]) record(two, now, value);

		const rows = metricWindow(
			[
				{ port: 3000, series: one },
				{ port: 3001, series: two }
			],
			'avg',
			now,
			windowMs
		);

		expect(rows[3].all).toBe(8);
	});

	// Anchored to the clock instead, a coarse row's boundaries slide a second at a time, so
	// points shuffle sideways and gaps open in a line whose samples have not changed
	it('keeps a past row on the same grid as the clock moves through it', () => {
		const series = newSeries(t0);
		for (const at of [2_000, 3_500, 9_000, 21_000]) record(series, t0 + at, 7);
		const drawn = (clock: number) =>
			metricWindow([{ port, series }], 'avg', clock, 60_000, 5_000)
				.filter((row) => row[port] !== null)
				.map((row) => row.time.getTime());

		const settled = drawn(t0 + 30_000);
		expect(drawn(t0 + 31_000)).toEqual(settled);
		expect(drawn(t0 + 34_000)).toEqual(settled);
	});

	// What the chart cannot be eyeballed for: the last interval alone would read 5 here
	it('totals the whole window rather than its last interval', () => {
		const series = newSeries(now - 3 * BASE_INTERVAL_MS);
		record(series, now - 3 * BASE_INTERVAL_MS, 2);
		record(series, now - BASE_INTERVAL_MS, 3);
		record(series, now, 5);

		expect(metricTotals([{ port }], 'sum', now, windowMs)[port]).toBe(0);
		expect(metricTotals([{ port, series }], 'sum', now, windowMs)[port]).toBe(10);
	});

	// The readout is folded from the same buckets as the chart, so it cannot contradict it:
	// where a running total ends is what the window holds
	it('agrees with where a running total ends', () => {
		const series = newSeries(now - 3 * BASE_INTERVAL_MS);
		record(series, now - 3 * BASE_INTERVAL_MS, 2);
		record(series, now, 5);
		const lines = [{ port, series }];

		const drawn = metricWindow(lines, 'cumsum', now, windowMs);
		expect(metricTotals(lines, 'cumsum', now, windowMs)[port]).toBe(drawn[drawn.length - 1][port]);
	});

	it('draws silence either side of a count as zero', () => {
		const series = newSeries(now - BASE_INTERVAL_MS);
		record(series, now - BASE_INTERVAL_MS, 2);
		const rows = metricWindow([{ port, series }], 'n', now, windowMs);

		expect(column(rows, -3)).toBe(0);
		expect(column(rows, -1)).toBe(1);
		expect(column(rows, 0)).toBe(0);
	});

	it('leaves a gap either side for a statistic nothing can be averaged into', () => {
		const series = newSeries(now - BASE_INTERVAL_MS);
		record(series, now - BASE_INTERVAL_MS, 2);
		const rows = metricWindow([{ port, series }], 'avg', now, windowMs);

		expect(column(rows, -3)).toBeNull();
		expect(column(rows, -1)).toBe(2);
		expect(column(rows, 0)).toBeNull();
	});
});
