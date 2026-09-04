<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import { STATUS_TEXT } from '$lib/status';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import type { Stream } from '$lib/resource-log.svelte';

	const ALL = 'all';
	// As many as CloudWatch's console lists as recent streams
	const MAX_SHOWN = 10;

	let {
		nodeId,
		selected = $bindable()
	}: {
		nodeId: string;
		selected: Stream['source'] | 'all';
	} = $props();

	const orchestrator = getOrchestrator();

	// Newest first, and only the recent ones: an older stream keeps its lines in the "all"
	// view and just leaves the list
	const streams = $derived(orchestrator.getStreams(nodeId).slice(-MAX_SHOWN).reverse());

	// Takes back a choice that has left the list, so a caller reads a real source back
	$effect(() => {
		if (selected !== ALL && !streams.some((stream) => stream.source === selected)) selected = ALL;
	});

	// An instance's own status says more than whether it has exited
	function status(stream: Stream) {
		if (typeof stream.source === 'number') {
			return orchestrator.getInstanceStatus(nodeId, stream.source);
		}
		return stream.alive ? 'running' : 'stopped';
	}
</script>

{#snippet option(stream: Stream | typeof ALL)}
	{#if stream === ALL}
		{@const all = orchestrator.getStatus(nodeId)}
		<StatusDot status={all} label={STATUS_TEXT[all]} />
		All streams
	{:else}
		{@const dot = status(stream)}
		<StatusDot status={dot} label={STATUS_TEXT[dot]} />
		{stream.label}
	{/if}
{/snippet}

<!-- One stream is not a choice, and the row closes up around the missing control -->
{#if streams.length > 1}
	<Select.Root
		type="single"
		value={String(selected)}
		onValueChange={(value) =>
			(selected = streams.find((stream) => String(stream.source) === value)?.source ?? ALL)}
	>
		<Select.Trigger class="min-w-0 flex-1 overflow-hidden" aria-label="Which stream is shown">
			<!-- One child, so the trigger's justify-between keeps the label off the middle -->
			<span class="flex items-center gap-1.5">
				{@render option(streams.find((stream) => stream.source === selected) ?? ALL)}
			</span>
		</Select.Trigger>
		<Select.Content>
			<Select.Item value={ALL}>{@render option(ALL)}</Select.Item>
			{#each streams as stream (stream.source)}
				<Select.Item value={String(stream.source)}>{@render option(stream)}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{/if}
