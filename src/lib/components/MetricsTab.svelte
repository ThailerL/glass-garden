<script lang="ts">
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getGraphState, nodeChart } from '$lib/graph-state.svelte';
	import { getResourceDefinition, type Instance } from '$lib/resources';
	import { STATUS_TEXT, uptimeText } from '$lib/status';
	import { METRIC_WINDOWS, metricsView } from '$lib/metrics-view.svelte';
	import * as Select from '$lib/components/ui/select';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import MetricChart from '$lib/components/MetricChart.svelte';

	const { nodeId }: { nodeId: string } = $props();
	const orchestrator = getOrchestrator();
	const graphState = getGraphState();

	const node = $derived(graphState.getNode(nodeId));
	const type = $derived(node?.type ?? '');
	const definition = $derived(node && getResourceDefinition(node.type));
	const ports = $derived(orchestrator.getReservedPorts(nodeId));
	const runsProcesses = $derived(definition?.runsProcesses ?? true);
	const instancePorts = $derived(runsProcesses ? ports : []);

	const instances = $derived(orchestrator.getInstances(nodeId));
	const metrics = $derived(orchestrator.getMetrics(nodeId));

	const now = $derived(metricsView.now);

	const metricNames = $derived(Object.keys(metrics).sort());

	// Every series a name has been published under, whatever its dimensions
	const chartFor = (name: string) =>
		metricsView.chart(
			type,
			name,
			Object.values(metrics[name] ?? {}),
			definition?.metricDefaults?.[name]
		);

	function statusLabel(instance: Instance | undefined) {
		if (!instance) return STATUS_TEXT.stopped;
		if (instance.status === 'crashed' && orchestrator.getRestartPending(nodeId)) {
			return 'Waiting to retry';
		}
		if (instance.status === 'starting' && instance.replacement) return 'Retrying';
		return STATUS_TEXT[instance.status];
	}
</script>

<div class="flex h-full flex-col gap-3">
	<dl class="flex gap-2 text-sm">
		<dt class="text-muted-foreground">Restarts</dt>
		<dd class="tabular-nums">{orchestrator.getRestarts(nodeId)}</dd>
	</dl>

	{#if orchestrator.getRestartsPaused(nodeId)}
		<p class="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
			Restarts paused - instances kept crashing before coming up. Change the config and try again.
		</p>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto text-sm">
		<ul>
			{#if !runsProcesses}
				{@const only = instances[0]}
				<li class="flex items-center gap-2 border-b py-1.5 last:border-b-0">
					<StatusDot status={only?.status ?? 'stopped'} />
					<span class="text-muted-foreground">{statusLabel(only)}</span>
					{#if uptimeText(only, now)}
						<span class="text-xs text-muted-foreground tabular-nums">{uptimeText(only, now)}</span>
					{/if}
				</li>
			{/if}
			{#each instancePorts as port (port)}
				{@const instance = instances.find((candidate) => candidate.port === port)}
				{@const instanceStatus = instance?.status ?? 'stopped'}
				{@const url = definition?.hasPreview ? instance?.previewUrl : undefined}
				{@const uptime = uptimeText(instance, now)}
				<li class="flex items-center gap-2 border-b py-1.5 last:border-b-0">
					<StatusDot status={instanceStatus} />
					<span class="font-mono tabular-nums">:{port}</span>
					<span class="text-muted-foreground">{statusLabel(instance)}</span>
					{#if uptime}
						<span class="text-xs text-muted-foreground tabular-nums">{uptime}</span>
					{/if}
					{#if url}
						<!-- Served by the preview service worker rather than by SvelteKit routing, so
				     there is no route for resolve() to take -->
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							href={url}
							target="_blank"
							rel="noreferrer"
							class="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
						>
							Open
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/if}
				</li>
			{/each}
		</ul>

		{#if metricNames.length === 0}
			<p class="pt-2 text-xs text-muted-foreground">
				No measurements yet. Resources report their own numbers as they run.
			</p>
		{:else}
			<div class="mt-4 space-y-3 border-t pt-3" data-tour="metrics-charts">
				<!-- With the charts it governs rather than above the statuses, which it does not -->
				<Select.Root
					type="single"
					value={String(metricsView.window.ms)}
					onValueChange={(value) => metricsView.setWindow(Number(value))}
				>
					<Select.Trigger class="w-28 shrink-0 text-xs" aria-label="How far back the charts reach">
						Last {metricsView.window.label}
					</Select.Trigger>
					<Select.Content>
						{#each METRIC_WINDOWS as option (option.ms)}
							<Select.Item value={String(option.ms)}>{option.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>

				{#each metricNames as name (name)}
					{@const chart = chartFor(name)}
					<MetricChart
						{name}
						lines={chart.lines}
						hidden={chart.hidden}
						dimensions={chart.options}
						canAddDimensions={definition?.hasEditableFiles ?? false}
						bind:pinned={
							() => node !== undefined && nodeChart(node) === name,
							(value) => graphState.setNodeChart(nodeId, value ? name : undefined)
						}
						bind:stat={() => chart.stat, (value) => metricsView.setStat(type, name, value)}
						bind:breakdown={
							() => chart.breakdown, (value) => metricsView.setBreakdown(type, name, value)
						}
					/>
				{/each}
			</div>
		{/if}
	</div>
</div>
