<script lang="ts">
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getResourceDefinition, type Instance } from '$lib/resources';
	import { STATUS_TEXT } from '$lib/status';
	import { latest, statistic } from '$lib/metrics';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import InstanceSelect from '$lib/components/InstanceSelect.svelte';

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

	// The union across instances, so every row carries the same labels and an instance that
	// has not reported one yet shows a dash rather than a shorter list. Taken from every
	// reserved port rather than the shown ones, so filtering to one instance keeps the set.
	// Sorted, because arrival order is whichever line printed first and would reshuffle
	const metricNames = $derived(
		[...new Set(ports.flatMap((port) => Object.keys(metrics[port] ?? {})))].sort()
	);

	function reading(port: number, name: string) {
		const series = metrics[port]?.[name];
		const bucket = series && latest(series, now);
		return bucket && { value: statistic(bucket, 'avg'), samples: bucket.n };
	}

	// A dash where there is nothing current, so a gap never reads as a measured zero
	function format(value: number | undefined) {
		if (value === undefined) return '-';
		return Number.isInteger(value) ? String(value) : value.toFixed(2);
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
	<div class="flex">
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
				<li class="border-b py-1.5 last:border-b-0">
					<div class="flex items-center gap-2">
						<StatusDot status={instanceStatus} />
						<span class="font-mono tabular-nums">:{port}</span>
						<span class="text-muted-foreground">{statusLabel(instance)}</span>
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
					</div>

					{#each metricNames as name (name)}
						{@const current = reading(port, name)}
						<dl class="mt-1 flex items-baseline gap-2 pl-4 text-xs">
							<dt class="truncate text-muted-foreground">{name}</dt>
							<dd class="ml-auto tabular-nums">{format(current?.value)}</dd>
							<!-- How many landed in the interval, so a rate is not read as one reading -->
							<dd class="w-10 text-right text-muted-foreground">
								{current && current.samples > 1 ? `×${current.samples}` : ''}
							</dd>
						</dl>
					{/each}
				</li>
			{/each}
		</ul>

		{#if metricNames.length === 0}
			<p class="pt-2 text-xs text-muted-foreground">
				No measurements yet. Resources report their own numbers as they run.
			</p>
		{/if}
	</div>
</div>
