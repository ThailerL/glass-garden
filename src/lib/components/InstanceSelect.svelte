<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';

	const ALL = 'all';

	let {
		nodeId,
		selected = $bindable(),
		all = false
	}: {
		nodeId: string;
		// 'all' only ever appears when this select offers it
		selected: number | 'all' | undefined;
		all?: boolean;
	} = $props();

	const orchestrator = getOrchestrator();

	// Reserved rather than live ports, so an instance that is down is still selectable and
	// the list doesn't reshuffle as they come and go
	const ports = $derived(orchestrator.getReservedPorts(nodeId));

	// Whether the choice still names something this node has
	const offered = $derived(
		selected === ALL ? all : selected !== undefined && ports.includes(selected)
	);

	// Settles what nothing chosen yet means, and takes back a choice a scale-down has removed,
	// so a caller reads a real port back rather than carrying its own fallback
	$effect(() => {
		if (!offered) selected = all ? ALL : ports[0];
	});

	function status(port: number | 'all') {
		return port === ALL
			? orchestrator.getStatus(nodeId)
			: orchestrator.getInstanceStatus(nodeId, port);
	}
</script>

{#snippet option(port: number | 'all')}
	<StatusDot status={status(port)} />
	{port === ALL ? 'All instances' : `:${port}`}
{/snippet}

<!-- One instance is not a choice, and the row closes up around the missing control -->
{#if ports.length > 1 && selected !== undefined}
	<Select.Root
		type="single"
		value={String(selected)}
		onValueChange={(value) => (selected = value === ALL ? ALL : Number(value))}
	>
		<Select.Trigger class="min-w-0 flex-1 overflow-hidden">
			<!-- One child, so the trigger's justify-between keeps the label off the middle -->
			<span class="flex items-center gap-1.5">{@render option(selected)}</span>
		</Select.Trigger>
		<Select.Content>
			{#if all}
				<Select.Item value={ALL}>{@render option(ALL)}</Select.Item>
			{/if}
			{#each ports as reserved (reserved)}
				<Select.Item value={String(reserved)}>{@render option(reserved)}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{/if}
