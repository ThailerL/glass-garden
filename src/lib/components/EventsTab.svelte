<script lang="ts">
	import { getOrchestrator } from '$lib/orchestrator.svelte';

	const { nodeId }: { nodeId: string } = $props();
	const orchestrator = getOrchestrator();

	const events = $derived(orchestrator.getEvents(nodeId));

	const levelClass = {
		info: 'bg-blue-500',
		warning: 'bg-amber-500',
		error: 'bg-red-500'
	};

	const timeFormat = new Intl.DateTimeFormat(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
</script>

{#if events.length === 0}
	<p class="p-2 text-sm text-muted-foreground">No events yet</p>
{:else}
	<ul class="flex flex-col gap-1 p-1 text-sm">
		{#each events as event (event)}
			<li class="flex items-start gap-2">
				<span class={['mt-1.5 size-2 shrink-0 rounded-full', levelClass[event.level]]}></span>
				<p>
					<span class="text-muted-foreground tabular-nums">{timeFormat.format(event.time)}</span>
					{event.message}
				</p>
			</li>
		{/each}
	</ul>
{/if}
