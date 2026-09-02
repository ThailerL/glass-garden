<script lang="ts">
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getResourceDefinition, type Instance } from '$lib/resources';
	import { STATUS_TEXT, uptimeText } from '$lib/status';
	import { METRIC_WINDOWS, metricsView } from '$lib/metrics-view.svelte';
	import * as Select from '$lib/components/ui/select';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import InstanceSelect from '$lib/components/InstanceSelect.svelte';
	import MetricChart, { type ChartLine } from '$lib/components/MetricChart.svelte';

	const { nodeId }: { nodeId: string } = $props();
	const orchestrator = getOrchestrator();
	const graphState = getGraphState();

	let selected = $state<number | 'all'>('all');

	const node = $derived(graphState.getNode(nodeId));
	const type = $derived(node?.type ?? '');
	const definition = $derived(node && getResourceDefinition(node.type));
	const ports = $derived(orchestrator.getReservedPorts(nodeId));
	const runsProcesses = $derived(definition?.runsProcesses ?? true);
	const instancePorts = $derived(runsProcesses ? ports : []);
	const shown = $derived(
		selected === 'all' ? instancePorts : instancePorts.filter((port) => port === selected)
	);

	const instances = $derived(orchestrator.getInstances(nodeId));
	const metrics = $derived(orchestrator.getMetrics(nodeId));

	// A reading goes stale on its own, so the readout has to move without new samples
	let now = $state(Date.now());
	$effect(() => {
		const clock = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(clock);
	});

	// What the region reports for the node as a whole, which has no instance behind it
	const resourceMetrics = $derived(metrics.resource ?? {});

	// The union across every reserved port and the node itself, so narrowing the selection
	// keeps the set
	const metricNames = $derived(
		[
			...new Set([
				...Object.keys(resourceMetrics),
				...ports.flatMap((port) => Object.keys(metrics[port] ?? {}))
			])
		].sort()
	);

	// A resource says how its own metrics are read; anything else sums, since the avg of a count
	// reported as 1 per event is 1 by construction, which draws a flat line
	const statFor = (name: string) =>
		metricsView.stat(type, name) ?? definition?.metricDefaults?.[name] ?? 'sum';

	// Keyed on the port's place among every reserved port, so narrowing the selection does not
	// repaint the survivors
	const colorOf = (port: number) => `var(--chart-${(ports.indexOf(port) % 5) + 1})`;

	// Every shown instance, reporting this metric or not, so a chart's legend never changes
	// under the reader. A node-level reading belongs to no instance, so it is drawn whatever
	// the selection narrows to
	function linesFor(name: string): ChartLine[] {
		const lines: ChartLine[] = shown.map((port) => ({
			port,
			color: colorOf(port),
			series: metrics[port]?.[name]
		}));
		if (resourceMetrics[name]) {
			lines.unshift({ port: 'resource', color: 'var(--chart-1)', series: resourceMetrics[name] });
		}
		return lines;
	}

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
	<div class="flex gap-2">
		<Select.Root
			type="single"
			value={String(metricsView.window.ms)}
			onValueChange={(value) => metricsView.setWindow(Number(value))}
		>
			<Select.Trigger class="w-24 shrink-0 text-xs" aria-label="How far back the charts reach">
				{metricsView.window.label}
			</Select.Trigger>
			<Select.Content>
				{#each METRIC_WINDOWS as option (option.ms)}
					<Select.Item value={String(option.ms)}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<InstanceSelect {nodeId} bind:selected all />
	</div>

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
			{#each shown as port (port)}
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
				{#each metricNames as name (name)}
					<MetricChart
						{name}
						lines={linesFor(name)}
						windowMs={metricsView.window.ms}
						intervalMs={metricsView.window.intervalMs}
						{now}
						bind:stat={() => statFor(name), (value) => metricsView.setStat(type, name, value)}
					/>
				{/each}
			</div>
		{/if}
	</div>
</div>
