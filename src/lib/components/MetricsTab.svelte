<script lang="ts">
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getResourceDefinition, type Instance } from '$lib/resources';
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

	function statusLabel(instance: Instance | undefined) {
		if (!instance) return 'stopped';
		return instance.status === 'starting' && instance.replacement ? 'retrying' : instance.status;
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

	<ul class="min-h-0 flex-1 overflow-y-auto text-sm">
		{#each shown as port (port)}
			{@const instance = instances.find((candidate) => candidate.port === port)}
			{@const instanceStatus = instance?.status ?? 'stopped'}
			{@const url = definition?.hasPreview ? instance?.previewUrl : undefined}
			<li class="flex items-center gap-2 border-b py-1.5 last:border-b-0">
				<StatusDot status={instanceStatus} />
				<span class="font-mono tabular-nums">:{port}</span>
				<span class="text-muted-foreground capitalize">{statusLabel(instance)}</span>
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
</div>
