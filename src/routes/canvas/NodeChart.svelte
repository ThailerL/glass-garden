<script lang="ts">
	import { LineChart } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getResourceDefinition } from '$lib/resources';
	import { metricsView } from '$lib/metrics-view.svelte';
	import { chartSeries, compact, metricWindow } from '$lib/metrics';

	const { nodeId, type, name }: { nodeId: string; type: string; name: string } = $props();
	const orchestrator = getOrchestrator();

	const chart = $derived(
		metricsView.chart(
			type,
			name,
			Object.values(orchestrator.getMetrics(nodeId)[name] ?? {}),
			getResourceDefinition(type).metricDefaults?.[name]
		)
	);
	const { now, window } = $derived(metricsView);
	const rows = $derived(metricWindow(chart.lines, chart.stat, now, window.ms, window.intervalMs));
	const { series, config } = $derived(chartSeries(chart.lines, name));

	// Floor and ceiling only: two rules bound the plot without ruling it
	const bounds = (scale: { domain: () => number[] }) => [0, scale.domain()[1]];
</script>

<!-- The window is named so a reader sees every node follow the tab's picker -->
<p class="truncate text-[0.6875rem] leading-none text-muted-foreground">
	{name} · {window.label}
</p>
<Chart.Container {config} class="aspect-auto h-16 w-full [&_.lc-text]:text-[0.625rem]">
	<!-- The tab's chart component, so a breakdown overlays here as it does there rather than
	     stacking. Only the chrome differs, which is what the space allows -->
	<LineChart
		data={rows}
		x="time"
		{series}
		axis="y"
		grid={{ x: false, y: true, yTicks: bounds }}
		highlight={false}
		padding={{ left: 10, right: 2, top: 6, bottom: 2 }}
		props={{
			spline: { strokeWidth: 2 },
			yAxis: { ticks: bounds, format: compact }
		}}
	/>
</Chart.Container>
