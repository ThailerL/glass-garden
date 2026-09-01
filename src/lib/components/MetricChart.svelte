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
		CHART_READINGS,
		READING_TEXT,
		metricTotals,
		metricWindow,
		type ChartReading,
		type MetricWindowRow
	} from '$lib/metrics';

	let {
		name,
		lines,
		stat = $bindable(),
		windowMs,
		intervalMs,
		now
	}: {
		name: string;
		lines: ChartLine[];
		stat: ChartReading;
		windowMs: number;
		intervalMs: number;
		now: number;
	} = $props();

	const series = $derived(
		lines.map(({ port, color }) => ({
			key: String(port),
			label: `:${port}`,
			color,
			value: (row: MetricWindowRow) => row[port] ?? null
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

	// The whole window rather than its last point, which the end of the line already shows
	const total = $derived(metricTotals(lines, stat, now, windowMs));
</script>

<!-- A section rather than a figure: a figcaption has to be a figure's immediate child, and
     the name shares its row with the picker -->
<section class="space-y-1" aria-label={name}>
	<!-- The legend drops to its own line when the instances outgrow the row -->
	<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
		<span class="min-w-0 truncate text-xs text-muted-foreground">{name}</span>
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

		<!-- The legend carries the value, so identifying a line and reading it are one thing -->
		<ul class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
			{#each lines as { port, color } (port)}
				<li class="flex items-center gap-1.5">
					<span class="size-2.5 rounded-xs" style="background-color: {color}"></span>
					<span class="font-mono text-muted-foreground tabular-nums">:{port}</span>
					<span class="tabular-nums">{format(total[port])}</span>
				</li>
			{/each}
			<!-- The group as a whole, which the chart deliberately does not draw: a line above
			     every other one would flatten the comparison they are here for -->
			{#if lines.length > 1}
				<li class="flex items-center gap-1.5 border-l pl-2">
					<span class="text-muted-foreground">all</span>
					<span class="tabular-nums">{format(total.all)}</span>
				</li>
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
