<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import { STATUS_TEXT } from '$lib/status';
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

	// Nothing chosen yet, or a choice a scale-down removed, falls back to the first instance
	const shown = $derived(
		selected !== undefined && (selected === ALL ? all : ports.includes(selected))
			? selected
			: all
				? ALL
				: ports[0]
	);

	// Written back so a caller reads a real port rather than carrying its own fallback
	$effect(() => {
		selected = shown;
	});

	function status(port: number | 'all') {
		return port === ALL
			? orchestrator.getStatus(nodeId)
			: orchestrator.getInstanceStatus(nodeId, port);
	}
</script>

{#snippet label(port: number | 'all')}
	{port === ALL ? 'All instances' : `:${port}`}
{/snippet}

{#snippet option(port: number | 'all')}
	{@const dot = status(port)}
	<StatusDot status={dot} label={STATUS_TEXT[dot]} />
	{@render label(port)}
{/snippet}

<!-- Part of an address, so the trigger is a chip in the text rather than a field, and the
     status dot stays in the list where it is what you pick by -->
{#if ports.length > 1}
	<Select.Root
		type="single"
		value={String(shown)}
		onValueChange={(value) => (selected = value === ALL ? ALL : Number(value))}
	>
		<Select.Trigger
			title="Choose which instance to preview"
			class="gap-0.5 rounded-sm border-0 bg-accent px-0.5 py-0 font-mono text-xs text-foreground shadow-none hover:bg-muted focus-visible:ring-0 data-[size=default]:h-auto dark:bg-accent dark:hover:bg-muted [&_svg]:size-3"
			aria-label="Which instance is shown"
		>
			{@render label(shown)}
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
{:else if ports.length}
	{@render label(shown)}
{/if}
