import { describe, it, expect } from 'vitest';
import {
	BASE_INTERVAL_MS,
	MAX_BUCKETS,
	METRIC_SENTINEL,
	STALE_AFTER_MS,
	latest,
	mergeBuckets,
	newSeries,
	parseMetricLine,
	record,
	statistic
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

describe('latest', () => {
	const now = t0 + 4 * BASE_INTERVAL_MS;

	it('is the newest interval, not a statistic over the whole series', () => {
		const series = newSeries(t0);
		record(series, t0, 5);
		record(series, now, 8);

		expect(latest(series, now)).toEqual({ n: 1, sum: 8, min: 8, max: 8 });
	});

	// Otherwise a resource that stopped reporting minutes ago reads as live
	it('is undefined once nothing has been reported for a while', () => {
		const series = newSeries(t0);
		record(series, t0, 5);

		expect(latest(series, t0 + STALE_AFTER_MS)).toEqual({ n: 1, sum: 5, min: 5, max: 5 });
		expect(latest(series, t0 + STALE_AFTER_MS + 1)).toBeUndefined();
	});

	it('is undefined before anything is reported', () => {
		expect(latest(newSeries(t0), t0)).toBeUndefined();
	});
});
