import { chartStat, metricChart, type ChartReading, type MetricSeries } from '$lib/metrics';

// Each carries the interval its points are folded to, holding every window to 60 points
export const METRIC_WINDOWS = [
	{ ms: 60_000, intervalMs: 1_000, label: '1 min' },
	{ ms: 300_000, intervalMs: 5_000, label: '5 min' },
	{ ms: 900_000, intervalMs: 15_000, label: '15 min' }
] as const;

export type MetricWindow = (typeof METRIC_WINDOWS)[number];

// How the charts are being looked at, which the panel that draws them cannot hold: the tab
// unmounts whenever the reader glances at Logs, and a picker that forgets on its own is worse
// than one that is occasionally set to the wrong thing
class MetricsView {
	window = $state<MetricWindow>(METRIC_WINDOWS[1]);

	// A reading goes stale on its own, so charts move without new samples
	now = $state(Date.now());

	constructor() {
		setInterval(() => (this.now = Date.now()), 1000);
	}

	// Keyed by resource type as well as by name
	#stats = $state<Partial<Record<string, ChartReading>>>({});

	stat(type: string, name: string) {
		return this.#stats[`${type}:${name}`];
	}

	setStat(type: string, name: string, reading: ChartReading) {
		this.#stats[`${type}:${name}`] = reading;
	}

	// Which dimension a metric is broken down by; undefined until chosen, so the tab can default
	#breakdowns = $state<Partial<Record<string, string>>>({});

	breakdown(type: string, name: string) {
		return this.#breakdowns[`${type}:${name}`];
	}

	setBreakdown(type: string, name: string, dimension: string) {
		this.#breakdowns[`${type}:${name}`] = dimension;
	}

	// A metric as it is drawn, wherever it is drawn, so no two charts of it can disagree
	chart(
		type: string,
		name: string,
		series: readonly MetricSeries[],
		resourceDefault: ChartReading | undefined
	) {
		return {
			...metricChart(series, this.breakdown(type, name)),
			stat: chartStat(this.stat(type, name), resourceDefault, series)
		};
	}

	// By width, since that is what a select can carry: the interval it folds to travels with it
	setWindow(ms: number) {
		const chosen = METRIC_WINDOWS.find((option) => option.ms === ms);
		if (chosen) this.window = chosen;
	}
}

export const metricsView = new MetricsView();
