import { describe, it, expect } from 'vitest';
import {
	PERIOD_MS,
	MAX_DATAPOINTS,
	CHART_READINGS,
	METRIC_STATISTICS,
	READING_TEXT,
	mergeStatistics,
	metricTotals,
	metricWindow,
	newSeries,
	dimensionKey,
	breakdownOptions,
	breakDown,
	NO_BREAKDOWN,
	MAX_LINES,
	parseEmfLine,
	defaultStatisticFor,
	looksLikeEmf,
	record,
	statistic,
	type MetricStatistic
} from './metrics';

// Divisible by PERIOD_MS, so it is itself the start of a period
const t0 = 1_700_000_000_000;

// One EMF line as aws-embedded-metrics prints it, with the values it declares
const emf = (
	metrics: { Name: string; Unit?: string }[],
	values: Record<string, unknown>,
	extra: { Namespace?: string; Dimensions?: string[][] } = {}
) =>
	JSON.stringify({
		_aws: {
			Timestamp: t0,
			CloudWatchMetrics: [{ Namespace: 'app', Dimensions: [[]], ...extra, Metrics: metrics }]
		},
		...values
	});

describe('parseEmfLine', () => {
	it('reads every declared metric with its unit', () => {
		const parsed = parseEmfLine(
			emf(
				[
					{ Name: 'requests', Unit: 'Count' },
					{ Name: 'latency', Unit: 'Milliseconds' }
				],
				{
					requests: 1,
					latency: 12.5
				}
			)
		);
		expect(parsed).toMatchObject({
			ok: true,
			data: [
				{ name: 'requests', value: 1, unit: 'Count' },
				{ name: 'latency', value: 12.5, unit: 'Milliseconds' }
			]
		});
	});

	it('reads an array of values as one observation each', () => {
		const parsed = parseEmfLine(emf([{ Name: 'latency' }], { latency: [3, 5] }));
		expect(parsed).toMatchObject({
			ok: true,
			data: [
				{ name: 'latency', value: 3 },
				{ name: 'latency', value: 5 }
			]
		});
	});

	it('reads a metric declared under several dimension sets as one series per set', () => {
		const line = JSON.stringify({
			_aws: {
				Timestamp: t0,
				CloudWatchMetrics: [
					{ Namespace: 'app', Dimensions: [['route'], []], Metrics: [{ Name: 'requests' }] },
					{ Namespace: 'app', Dimensions: [['route']], Metrics: [{ Name: 'requests' }] }
				]
			},
			route: '/',
			requests: 1
		});
		const parsed = parseEmfLine(line);
		expect(parsed.ok && parsed.data).toEqual([
			{ name: 'requests', value: 1, unit: undefined, dimensions: { route: '/' } },
			{ name: 'requests', value: 1, unit: undefined, dimensions: {} }
		]);
	});

	it('takes dimension values from the top level and drops a name with no value there', () => {
		const parsed = parseEmfLine(
			emf(
				[{ Name: 'requests' }],
				{ requests: 1, instance: 3000 },
				{ Dimensions: [['instance', 'route']] }
			)
		);
		expect(parsed.ok && parsed.data[0].dimensions).toEqual({ instance: '3000' });
	});

	it.each([
		['not JSON at all', '{oh dear'],
		['no _aws block', JSON.stringify({ requests: 1 })],
		['no CloudWatchMetrics', JSON.stringify({ _aws: { Timestamp: t0 } })],
		['a metric without a name', emf([{ Unit: 'Count' } as never], { requests: 1 })],
		['a missing value', emf([{ Name: 'requests' }], {})],
		['a non-finite value', emf([{ Name: 'requests' }], { requests: 'many' })]
	])('refuses %s', (_, text) => {
		expect(parseEmfLine(text).ok).toBe(false);
	});
});

describe('looksLikeEmf', () => {
	it('picks out EMF without parsing ordinary JSON output', () => {
		expect(looksLikeEmf(emf([{ Name: 'requests' }], { requests: 1 }))).toBe(true);
		expect(looksLikeEmf(JSON.stringify({ level: 'info', message: 'hello' }))).toBe(false);
		expect(looksLikeEmf('Server running on http://localhost:3000')).toBe(false);
	});
});

describe('defaultStatisticFor', () => {
	it('sums counts and averages measurements', () => {
		expect(defaultStatisticFor(undefined)).toBe('Sum');
		expect(defaultStatisticFor('Count')).toBe('Sum');
		expect(defaultStatisticFor('None')).toBe('Sum');
		expect(defaultStatisticFor('Milliseconds')).toBe('Average');
		expect(defaultStatisticFor('Megabytes')).toBe('Average');
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

describe('dimensionKey', () => {
	it('is the same whichever order the dimensions came in, and empty for none', () => {
		expect(dimensionKey({ a: '1', b: '2' })).toBe(dimensionKey({ b: '2', a: '1' }));
		expect(dimensionKey({ a: '1' })).not.toBe(dimensionKey({ a: '2' }));
		expect(dimensionKey({})).toBe('');
	});
});

describe('breakdown', () => {
	const at = (dimensions: Record<string, string>, value: number) => {
		const series = newSeries(t0, 'Count', dimensions);
		record(series, t0, value);
		return series;
	};
	// Three instances, two routes, one series per pair
	const grid = [
		at({ instance: 'a', route: '/' }, 1),
		at({ instance: 'a', route: '/x' }, 2),
		at({ instance: 'b', route: '/' }, 4),
		at({ instance: 'b', route: '/x' }, 8)
	];

	it('offers only the dimensions that separate something', () => {
		expect(breakdownOptions(grid)).toEqual(['instance', 'route']);
		expect(breakdownOptions([at({ service: 'app' }, 1), at({ service: 'app' }, 2)])).toEqual([]);
		expect(breakdownOptions([at({}, 1)])).toEqual([]);
	});

	it('groups by the chosen dimension and folds the rest into each line', () => {
		const { lines, hidden } = breakDown(grid, 'instance');
		expect(hidden).toEqual([]);
		expect(lines.map((line) => line.key)).toEqual(['a', 'b']);
		const rows = metricWindow(lines, 'Sum', t0, PERIOD_MS);
		expect(rows[0].values).toEqual({ a: 3, b: 12 });
		expect(rows[0].all).toBe(15);
	});

	it('folds everything into one line for no breakdown', () => {
		const { lines } = breakDown(grid, NO_BREAKDOWN);
		expect(lines).toHaveLength(1);
		expect(metricWindow(lines, 'Sum', t0, PERIOD_MS)[0].values.all).toBe(15);
	});

	// The publisher's own dimensionless series is already the whole; folding it in with the
	// per-instance ones would count every observation twice
	it('prefers a dimensionless series as the whole over a fold of the rest', () => {
		const { lines } = breakDown([...grid, at({}, 15)], NO_BREAKDOWN);
		expect(metricWindow(lines, 'Sum', t0, PERIOD_MS)[0].values.all).toBe(15);
	});

	it('draws the first values of a breakdown and hands back the rest', () => {
		const many = Array.from({ length: MAX_LINES + 3 }, (_, i) => at({ id: String(i) }, 1));
		const { lines, hidden } = breakDown(many, 'id');
		expect(lines).toHaveLength(MAX_LINES);
		expect(hidden).toHaveLength(3);
	});

	// Otherwise the legend reads a total of what fitted beside a count of what did not
	it('totals every line, drawn or not', () => {
		const many = Array.from({ length: MAX_LINES + 3 }, (_, i) => at({ id: String(i) }, 1));
		const { lines, hidden } = breakDown(many, 'id');
		expect(metricWindow(lines, 'Sum', t0, PERIOD_MS)[0].all).toBe(MAX_LINES);
		expect(metricWindow([...lines, ...hidden], 'Sum', t0, PERIOD_MS)[0].all).toBe(MAX_LINES + 3);
	});
});

describe('metricWindow', () => {
	const key = '3000';
	// The window ends at the datapoint after `now`, so this is its last column
	const now = t0 + 5 * PERIOD_MS;
	const windowMs = 4 * PERIOD_MS;

	function column(rows: ReturnType<typeof metricWindow>, offset: number) {
		return rows.find((row) => row.time.getTime() === now + offset * PERIOD_MS)?.values[key];
	}

	it('spans the full window whatever the series holds', () => {
		const series = newSeries(now);
		const rows = metricWindow([{ key, series: [series] }], 'Sum', now, windowMs);

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
				{ key: '3000', series: [early] },
				{ key: '3001', series: [late] }
			],
			'Sum',
			now,
			windowMs
		);

		expect(rows[0].values['3000']).toBe(4);
		// It had counted nothing yet, which is zero rather than unknown
		expect(rows[0].values['3001']).toBe(0);
		expect(rows[3].values['3000']).toBe(0);
		expect(rows[3].values['3001']).toBe(9);
	});

	// Otherwise an instance that has served nothing reads differently from one that has been
	// idle a minute, though both counted nothing just now
	it('counts zero for a line that has never reported', () => {
		const rows = metricWindow([{ key, series: [] }], 'Sum', now, windowMs);

		expect(rows).toHaveLength(4);
		expect(rows.every((row) => row.values[key] === 0)).toBe(true);
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
			metricWindow([{ key, series: [series] }], stat, last, windowMs, windowMs)[0].values[key];

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

		const rows = metricWindow([{ key, series: [series] }], 'RunningSum', now, windowMs);

		// Climbs and never falls, holding its level through the silent interval
		expect(rows.map((row) => row.values[key])).toEqual([2, 2, 5, 10]);
	});

	// Anchored to the range shown, so it answers "how many over this window" rather than
	// "how many ever"
	it('starts the running total again at the left edge of a shorter window', () => {
		const series = newSeries(now - 3 * PERIOD_MS);
		record(series, now - 3 * PERIOD_MS, 2);
		record(series, now, 5);

		const narrow = metricWindow([{ key, series: [series] }], 'RunningSum', now, 2 * PERIOD_MS);

		expect(narrow.map((row) => row.values[key])).toEqual([0, 5]);
	});

	it('totals every line for a sum', () => {
		const one = newSeries(now);
		record(one, now, 4);
		const two = newSeries(now);
		for (const value of [3, 5]) record(two, now, value);

		const rows = metricWindow(
			[
				{ key: '3000', series: [one] },
				{ key: '3001', series: [two] },
				{ key: '3002', series: [] }
			],
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
				{ key: '3000', series: [one] },
				{ key: '3001', series: [two] }
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
			metricWindow([{ key, series: [series] }], 'Average', clock, 60_000, 5_000)
				.filter((row) => row.values[key] !== null)
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

		expect(metricTotals([{ key, series: [] }], 'Sum', now, windowMs).values[key]).toBe(0);
		expect(metricTotals([{ key, series: [series] }], 'Sum', now, windowMs).values[key]).toBe(10);
	});

	// The readout is folded from the same datapoints as the chart, so it cannot contradict it:
	// where a running total ends is what the window holds
	it('agrees with where a running total ends', () => {
		const series = newSeries(now - 3 * PERIOD_MS);
		record(series, now - 3 * PERIOD_MS, 2);
		record(series, now, 5);
		const lines = [{ key, series: [series] }];

		const drawn = metricWindow(lines, 'RunningSum', now, windowMs);
		expect(metricTotals(lines, 'RunningSum', now, windowMs).values[key]).toBe(
			drawn[drawn.length - 1].values[key]
		);
	});

	it('draws silence either side of a count as zero', () => {
		const series = newSeries(now - PERIOD_MS);
		record(series, now - PERIOD_MS, 2);
		const rows = metricWindow([{ key, series: [series] }], 'SampleCount', now, windowMs);

		expect(column(rows, -3)).toBe(0);
		expect(column(rows, -1)).toBe(1);
		expect(column(rows, 0)).toBe(0);
	});

	it('leaves a gap either side for a statistic nothing can be averaged into', () => {
		const series = newSeries(now - PERIOD_MS);
		record(series, now - PERIOD_MS, 2);
		const rows = metricWindow([{ key, series: [series] }], 'Average', now, windowMs);

		expect(column(rows, -3)).toBeNull();
		expect(column(rows, -1)).toBe(2);
		expect(column(rows, 0)).toBeNull();
	});
});
