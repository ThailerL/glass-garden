import { describe, it, expect } from 'vitest';
import {
	PERIOD_MS,
	MAX_DATAPOINTS,
	METRIC_SENTINEL,
	CHART_READINGS,
	METRIC_STATISTICS,
	READING_TEXT,
	mergeStatistics,
	metricTotals,
	metricWindow,
	newSeries,
	parseMetricLine,
	record,
	statistic,
	type MetricStatistic
} from './metrics';

// Divisible by PERIOD_MS, so it is itself the start of a period
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
	it('folds everything in one interval into one datapoint', () => {
		const series = newSeries(t0);
		for (const value of [3, 9, 5]) record(series, t0 + 100, value);

		expect(series.datapoints).toEqual([{ sampleCount: 3, sum: 17, minimum: 3, maximum: 9 }]);
	});

	it('keeps intervals apart and zero-fills the silence between them', () => {
		const series = newSeries(t0);
		record(series, t0, 1);
		record(series, t0 + 3 * PERIOD_MS, 4);

		expect(series.datapoints).toHaveLength(4);
		expect(series.datapoints[0]).toEqual({ sampleCount: 1, sum: 1, minimum: 1, maximum: 1 });
		expect(series.datapoints.slice(1, 3).every((datapoint) => datapoint.sampleCount === 0)).toBe(
			true
		);
		expect(series.datapoints[3]).toEqual({ sampleCount: 1, sum: 4, minimum: 4, maximum: 4 });
	});

	it('drops the oldest datapoints past capacity and moves start to match', () => {
		const series = newSeries(t0);
		record(series, t0, 1);
		record(series, t0 + MAX_DATAPOINTS * PERIOD_MS, 2);

		expect(series.datapoints).toHaveLength(MAX_DATAPOINTS);
		expect(series.start).toBe(t0 + PERIOD_MS);
		// The newest observation is still the newest datapoint after the trim
		expect(series.datapoints[MAX_DATAPOINTS - 1]).toEqual({
			sampleCount: 1,
			sum: 2,
			minimum: 2,
			maximum: 2
		});
	});
});

describe('mergeStatistics', () => {
	// The property that lets a line be emitted per event or pre-folded without the reader
	// being able to tell, so neither path is second class
	it('matches folding the same observations into a single datapoint', () => {
		const spread = newSeries(t0);
		record(spread, t0, 3);
		record(spread, t0, 9);
		record(spread, t0 + PERIOD_MS, 5);
		record(spread, t0 + 2 * PERIOD_MS, 7);

		const together = newSeries(t0);
		for (const value of [3, 9, 5, 7]) record(together, t0, value);

		expect(mergeStatistics(spread.datapoints)).toEqual(together.datapoints[0]);
	});

	it('is unaffected by the silent intervals it spans', () => {
		const quiet = newSeries(t0);
		record(quiet, t0, 6);
		record(quiet, t0 + 5 * PERIOD_MS, 2);

		const dense = newSeries(t0);
		record(dense, t0, 6);
		record(dense, t0 + PERIOD_MS, 2);

		expect(mergeStatistics(quiet.datapoints)).toEqual(mergeStatistics(dense.datapoints));
	});

	it('describes nothing when every datapoint is empty', () => {
		const series = newSeries(t0);
		record(series, t0 + 2 * PERIOD_MS, 1);

		expect(mergeStatistics(series.datapoints.slice(0, 2))).toEqual({
			sampleCount: 0,
			sum: 0,
			minimum: 0,
			maximum: 0
		});
	});
});

describe('statistic', () => {
	it('reads each one off a merged datapoint', () => {
		const series = newSeries(t0);
		for (const value of [2, 4, 6]) record(series, t0, value);
		const set = mergeStatistics(series.datapoints);

		expect(statistic(set, 'SampleCount')).toBe(3);
		expect(statistic(set, 'Sum')).toBe(12);
		expect(statistic(set, 'Average')).toBe(4);
		expect(statistic(set, 'Minimum')).toBe(2);
		expect(statistic(set, 'Maximum')).toBe(6);
	});

	// A dash rather than a zero the reader would take for a measurement
	it('has no answer but a count for an interval nothing landed in', () => {
		const empty = mergeStatistics([]);

		expect(statistic(empty, 'SampleCount')).toBe(0);
		expect(statistic(empty, 'Average')).toBeUndefined();
		expect(statistic(empty, 'Minimum')).toBeUndefined();
		expect(statistic(empty, 'Maximum')).toBeUndefined();
	});
});

describe('METRIC_STATISTICS', () => {
	// The picker is built from this list, so a missing field is unreachable
	it('offers every stored field, and Average', () => {
		// Fields are camelCase, statistics are CloudWatch's PascalCase names for the same things
		const stored = Object.keys(newSeries(t0).datapoints[0]).map(
			(field) => field[0].toUpperCase() + field.slice(1)
		);
		expect([...METRIC_STATISTICS].sort()).toEqual([...stored, 'Average'].sort());
	});

	// The picker reads from CHART_READINGS, so anything only in the statistics is unreachable
	it('is offered in full by the chart readings, which add a running sum', () => {
		expect(CHART_READINGS).toEqual([...METRIC_STATISTICS, 'RunningSum']);
		expect(Object.keys(READING_TEXT).sort()).toEqual([...CHART_READINGS].sort());
	});
});

describe('metricWindow', () => {
	const port = 3000;
	// The window ends at the datapoint after `now`, so this is its last column
	const now = t0 + 5 * PERIOD_MS;
	const windowMs = 4 * PERIOD_MS;

	function column(rows: ReturnType<typeof metricWindow>, offset: number) {
		return rows.find((row) => row.time.getTime() === now + offset * PERIOD_MS)?.[port];
	}

	it('spans the full window whatever the series holds', () => {
		const series = newSeries(now);
		const rows = metricWindow([{ port, series }], 'Sum', now, windowMs);

		expect(rows).toHaveLength(4);
		expect(rows[0].time.getTime()).toBe(now - 3 * PERIOD_MS);
		expect(rows[3].time.getTime()).toBe(now);
	});

	it('reads every line at the same instant, and keeps one line short of another', () => {
		const early = newSeries(now - 3 * PERIOD_MS);
		record(early, now - 3 * PERIOD_MS, 4);
		const late = newSeries(now);
		record(late, now, 9);

		const rows = metricWindow(
			[
				{ port: 3000, series: early },
				{ port: 3001, series: late }
			],
			'Sum',
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
		const rows = metricWindow([{ port }], 'Sum', now, windowMs);

		expect(rows).toHaveLength(4);
		expect(rows.every((row) => row[port] === 0)).toBe(true);
	});

	// The fold is associative, so a coarser interval must give the same answer over fewer
	// points, not a different one
	it('folds several base intervals into one point without changing the answer', () => {
		// Read at the end of a grid interval, so the single wide row is the one holding them
		const last = t0 + 3 * PERIOD_MS;
		const series = newSeries(t0);
		for (const [offset, value] of [
			[0, 2],
			[1, 6],
			[2, 4],
			[3, 8]
		]) {
			record(series, t0 + offset * PERIOD_MS, value);
		}
		const coarse = (stat: MetricStatistic) =>
			metricWindow([{ port, series }], stat, last, windowMs, windowMs)[0][port];

		expect(coarse('SampleCount')).toBe(4);
		expect(coarse('Sum')).toBe(20);
		expect(coarse('Average')).toBe(5);
		expect(coarse('Minimum')).toBe(2);
		expect(coarse('Maximum')).toBe(8);
	});

	// The figure the default app's page used to print, which nothing else answers now
	it('accumulates a running total across the window', () => {
		const series = newSeries(now - 3 * PERIOD_MS);
		record(series, now - 3 * PERIOD_MS, 2);
		record(series, now - PERIOD_MS, 3);
		record(series, now, 5);

		const rows = metricWindow([{ port, series }], 'RunningSum', now, windowMs);

		// Climbs and never falls, holding its level through the silent interval
		expect(rows.map((row) => row[port])).toEqual([2, 2, 5, 10]);
	});

	// Anchored to the range shown, so it answers "how many over this window" rather than
	// "how many ever"
	it('starts the running total again at the left edge of a shorter window', () => {
		const series = newSeries(now - 3 * PERIOD_MS);
		record(series, now - 3 * PERIOD_MS, 2);
		record(series, now, 5);

		const narrow = metricWindow([{ port, series }], 'RunningSum', now, 2 * PERIOD_MS);

		expect(narrow.map((row) => row[port])).toEqual([0, 5]);
	});

	it('totals every line for a sum', () => {
		const one = newSeries(now);
		record(one, now, 4);
		const two = newSeries(now);
		for (const value of [3, 5]) record(two, now, value);

		const rows = metricWindow(
			[{ port: 3000, series: one }, { port: 3001, series: two }, { port: 3002 }],
			'Sum',
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
			'Average',
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
			metricWindow([{ port, series }], 'Average', clock, 60_000, 5_000)
				.filter((row) => row[port] !== null)
				.map((row) => row.time.getTime());

		const settled = drawn(t0 + 30_000);
		expect(drawn(t0 + 31_000)).toEqual(settled);
		expect(drawn(t0 + 34_000)).toEqual(settled);
	});

	// What the chart cannot be eyeballed for: the last interval alone would read 5 here
	it('totals the whole window rather than its last interval', () => {
		const series = newSeries(now - 3 * PERIOD_MS);
		record(series, now - 3 * PERIOD_MS, 2);
		record(series, now - PERIOD_MS, 3);
		record(series, now, 5);

		expect(metricTotals([{ port }], 'Sum', now, windowMs)[port]).toBe(0);
		expect(metricTotals([{ port, series }], 'Sum', now, windowMs)[port]).toBe(10);
	});

	// The readout is folded from the same datapoints as the chart, so it cannot contradict it:
	// where a running total ends is what the window holds
	it('agrees with where a running total ends', () => {
		const series = newSeries(now - 3 * PERIOD_MS);
		record(series, now - 3 * PERIOD_MS, 2);
		record(series, now, 5);
		const lines = [{ port, series }];

		const drawn = metricWindow(lines, 'RunningSum', now, windowMs);
		expect(metricTotals(lines, 'RunningSum', now, windowMs)[port]).toBe(
			drawn[drawn.length - 1][port]
		);
	});

	it('draws silence either side of a count as zero', () => {
		const series = newSeries(now - PERIOD_MS);
		record(series, now - PERIOD_MS, 2);
		const rows = metricWindow([{ port, series }], 'SampleCount', now, windowMs);

		expect(column(rows, -3)).toBe(0);
		expect(column(rows, -1)).toBe(1);
		expect(column(rows, 0)).toBe(0);
	});

	it('leaves a gap either side for a statistic nothing can be averaged into', () => {
		const series = newSeries(now - PERIOD_MS);
		record(series, now - PERIOD_MS, 2);
		const rows = metricWindow([{ port, series }], 'Average', now, windowMs);

		expect(column(rows, -3)).toBeNull();
		expect(column(rows, -1)).toBe(2);
		expect(column(rows, 0)).toBeNull();
	});
});
