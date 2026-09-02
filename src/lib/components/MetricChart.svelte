<script lang="ts" module>
	import type { MetricLine } from '$lib/metrics';

	// Colour comes from the tab, so every chart agrees on it
	export type ChartLine = MetricLine & { color: string };
</script>

<script lang="ts">
	import { LineChart } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import * as Select from '$lib/components/ui/select';
	import {
		ALL_LINES,
		CHART_READINGS,
		NO_BREAKDOWN,
		READING_TEXT,
		metricTotals,
		metricWindow,
		unitOf,
		type ChartReading,
		type MetricWindowRow
	} from '$lib/metrics';

	let {
		name,
		lines,
		hidden,
		dimensions,
		canAddDimensions,
		breakdown = $bindable(),
		stat = $bindable(),
		windowMs,
		intervalMs,
		now
	}: {
		name: string;
		lines: ChartLine[];
		// Lines past the cap: counted in the legend and totalled with the rest, but not drawn
		hidden: MetricLine[];
		// What the metric can be broken down by. Empty leaves the picker in place but disabled,
		// so a metric whose code declares no dimensions still shows that it could
		dimensions: string[];
		// Whether the reader could add one: a resource whose code they cannot open has no
		// dimensions to gain, so the picker goes rather than sitting there disabled
		canAddDimensions: boolean;
		breakdown: string;
		stat: ChartReading;
		windowMs: number;
		intervalMs: number;
		now: number;
	} = $props();

	// A select cannot carry an empty value, so none travels under a name of its own
	const NONE = '(none)';

	// A sample count has no unit to show
	const unit = $derived(
		stat === 'SampleCount' ? undefined : unitOf(lines.flatMap((l) => l.series))
	);

	// The one line of an un-broken-down metric is the metric, so the tooltip names it that
	// rather than "all", which here would be the whole of nothing in particular
	const series = $derived(
		lines.map(({ key, color }) => ({
			key,
			label: key === ALL_LINES ? name : key,
			color,
			value: (row: MetricWindowRow) => row.values[key] ?? null
		}))
	);

	// Where the tooltip reads its labels and colours from
	const config = $derived(
		Object.fromEntries(series.map(({ key, label, color }) => [key, { label, color }]))
	);

	const pad = (part: number) => String(part).padStart(2, '0');
	const clock = (time: Date) => `${pad(time.getMinutes())}:${pad(time.getSeconds())}`;

	// Axis labels compete with the plot for width in a sidebar this narrow
	const compact = (value: number) =>
		Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value * 10) / 10);

	// A dash where there is nothing, so a gap never reads as a measured zero
	const format = (value: number | null | undefined) =>
		value === null || value === undefined ? '-' : compact(value);

	const rows = $derived(metricWindow(lines, stat, now, windowMs, intervalMs));

	// The whole window rather than its last point, which the end of the line already shows.
	// Over every line including the undrawn ones, so "all" is the metric and not the legend
	const total = $derived(metricTotals([...lines, ...hidden], stat, now, windowMs, intervalMs));
</script>

<!-- A section rather than a figure: a figcaption has to be a figure's immediate child, and
     the name shares its row with the pickers -->
<section class="space-y-1" aria-label={name}>
	<!-- Reads as a phrase - "Sum requests · Count by instance" - so the header states the
	     statistic, the metric and what its lines are, in that order. The legend drops to its
	     own line when the lines outgrow the row -->
	<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
		<Select.Root type="single" bind:value={stat}>
			<!-- Height needs the trigger's own data-size variant, or its h-9 wins -->
			<Select.Trigger
				class="w-28 shrink-0 py-0 pr-1 pl-2 text-xs data-[size=default]:h-6"
				aria-label="What {name} plots"
			>
				{READING_TEXT[stat]}
			</Select.Trigger>
			<Select.Content>
				{#each CHART_READINGS as option (option)}
					<Select.Item value={option}>{READING_TEXT[option]}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<span class="min-w-0 truncate text-xs">
			{name}{#if unit}<span class="ml-1 text-muted-foreground">· {unit}</span>{/if}
		</span>
		{#if dimensions.length > 0 || canAddDimensions}
			<Select.Root
				type="single"
				value={breakdown === NO_BREAKDOWN ? NONE : breakdown}
				onValueChange={(value) => (breakdown = value === NONE ? NO_BREAKDOWN : value)}
			>
				<Select.Trigger
					class="shrink-0 py-0 pr-1 pl-2 text-xs data-[size=default]:h-6"
					aria-label="What {name} is broken down by"
					disabled={dimensions.length === 0}
					title={dimensions.length === 0
						? 'Add a dimension to this metric in your code to break it down'
						: undefined}
				>
					by {breakdown === NO_BREAKDOWN ? 'none' : breakdown}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value={NONE}>none</Select.Item>
					{#each dimensions as dimension (dimension)}
						<Select.Item value={dimension}>{dimension}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}

		<!-- The legend carries the value, so identifying a line and reading it are one thing -->
		<ul class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
			{#each lines as { key, color } (key)}
				<li class="flex items-center gap-1.5">
					<span class="size-2.5 rounded-xs" style="background-color: {color}"></span>
					<!-- Named only where the name tells it from another line: the single line of a
					     metric with no breakdown is just the metric, and the swatch is enough -->
					{#if key !== ALL_LINES}
						<span class="font-mono text-muted-foreground tabular-nums">{key}</span>
					{/if}
					<span class="tabular-nums">{format(total.values[key])}</span>
				</li>
			{/each}
			<!-- The group as a whole, which the chart deliberately does not draw: a line above
			     every other one would flatten the comparison they are here for -->
			{#if lines.length + hidden.length > 1}
				<li class="flex items-center gap-1.5 border-l pl-2">
					<span class="text-muted-foreground">all</span>
					<span class="tabular-nums">{format(total.all)}</span>
				</li>
			{/if}
			{#if hidden.length > 0}
				<li class="text-muted-foreground">{hidden.length} more not drawn</li>
			{/if}
		</ul>
	</div>

	<Chart.Container {config} class="aspect-auto h-24 w-full">
		<LineChart
			data={rows}
			x="time"
			{series}
			padding={{ left: 30, bottom: 16, right: 6, top: 4 }}
			props={{
				spline: { strokeWidth: 2 },
				xAxis: { ticks: 2, format: clock },
				yAxis: { ticks: 3, format: compact }
			}}
		>
			{#snippet tooltip()}
				<Chart.Tooltip />
			{/snippet}
		</LineChart>
	</Chart.Container>
</section>
