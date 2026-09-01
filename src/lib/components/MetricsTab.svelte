<script lang="ts">
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getResourceDefinition, type Instance } from '$lib/resources';
	import { STATUS_TEXT, uptimeText } from '$lib/status';
	import { type ChartReading } from '$lib/metrics';
	import * as Select from '$lib/components/ui/select';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import InstanceSelect from '$lib/components/InstanceSelect.svelte';
	import MetricChart, { type ChartLine } from '$lib/components/MetricChart.svelte';

	const { nodeId }: { nodeId: string } = $props();
	const orchestrator = getOrchestrator();
	const graphState = getGraphState();

	let selected = $state<number | 'all'>('all');

	const node = $derived(graphState.getNode(nodeId));
	const definition = $derived(node && getResourceDefinition(node.type));
	const ports = $derived(orchestrator.getReservedPorts(nodeId));
	const shown = $derived(selected === 'all' ? ports : ports.filter((port) => port === selected));

	const instances = $derived(orchestrator.getInstances(nodeId));
	const metrics = $derived(orchestrator.getMetrics(nodeId));

	// A reading goes stale on its own, so the readout has to move without new samples
	let now = $state(Date.now());
	$effect(() => {
		const clock = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(clock);
	});

	// The union across every reserved port, so narrowing the selection keeps the set
	const metricNames = $derived(
		[...new Set(ports.flatMap((port) => Object.keys(metrics[port] ?? {})))].sort()
	);

	// Per metric, since a node reports counts and measurements side by side. Sum by default:
	// the avg of a count reported as 1 per event is 1 by construction, which draws a flat line
	const stats = $state<Partial<Record<string, ChartReading>>>({});
	const statFor = (name: string) => stats[name] ?? 'sum';

	let windowMs = $state(60_000);

	// Each carries the interval its points are folded to, holding every window to 60 points
	const WINDOWS = [
		{ ms: 60_000, intervalMs: 1_000, label: '1 min' },
		{ ms: 300_000, intervalMs: 5_000, label: '5 min' },
		{ ms: 900_000, intervalMs: 15_000, label: '15 min' }
	];

	const range = $derived(WINDOWS.find((option) => option.ms === windowMs) ?? WINDOWS[0]);

	// Keyed on the port's place among every reserved port, so narrowing the selection does not
	// repaint the survivors
	const colorOf = (port: number) => `var(--chart-${(ports.indexOf(port) % 5) + 1})`;

	// Every shown instance, reporting this metric or not, so a chart's legend never changes
	// under the reader
	function linesFor(name: string): ChartLine[] {
		return shown.map((port) => ({ port, color: colorOf(port), series: metrics[port]?.[name] }));
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
			value={String(windowMs)}
			onValueChange={(value) => (windowMs = Number(value))}
		>
			<Select.Trigger class="w-24 shrink-0 text-xs" aria-label="How far back the charts reach">
				{range.label}
			</Select.Trigger>
			<Select.Content>
				{#each WINDOWS as option (option.ms)}
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
			<div class="mt-4 space-y-3 border-t pt-3">
				{#each metricNames as name (name)}
					{@const lines = linesFor(name)}
					{#if lines.length > 0}
						<MetricChart
							{name}
							{lines}
							windowMs={range.ms}
							intervalMs={range.intervalMs}
							{now}
							bind:stat={() => statFor(name), (value) => (stats[name] = value)}
						/>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</div>
