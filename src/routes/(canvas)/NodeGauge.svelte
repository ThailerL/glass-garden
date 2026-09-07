<script lang="ts">
	import type { NodeLevel } from '$lib/traffic.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	const { level, label }: { level: NodeLevel; label?: string } = $props();

	// Without a capacity the full mark is the most held so far, never under ten
	const full = $derived(level.capacity ?? Math.max(10, level.peak));
	const fraction = $derived(Math.min(1, level.value / full));
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<!-- The bar is a hairline, so the hit area around it is what gets hovered -->
			<div {...props} class="absolute inset-x-3 bottom-0 flex h-4 items-end pb-1.5">
				<!-- A level, never a number: a number would be read against the Metrics tab's statistic -->
				<div class="h-1 w-full overflow-hidden rounded-full bg-muted">
					<div
						class="h-full rounded-full bg-primary transition-[width] duration-300"
						style:width="{fraction * 100}%"
					></div>
				</div>
			</div>
		{/snippet}
	</Tooltip.Trigger>
	{#if label}
		<Tooltip.Content>{label}</Tooltip.Content>
	{/if}
</Tooltip.Root>
