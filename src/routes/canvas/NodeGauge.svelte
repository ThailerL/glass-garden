<script module lang="ts">
	import type { NodeLevel } from '$lib/traffic.svelte';

	const MOST_SLOTS = 16;

	// A peak-based full mark would change what a slot is worth as the peak grows
	export function slots(level: NodeLevel): { count: number; lit: number } | undefined {
		const { capacity } = level;
		if (capacity === undefined) return undefined;
		if (!Number.isInteger(capacity) || capacity < 1 || capacity > MOST_SLOTS) return undefined;

		return { count: capacity, lit: Math.min(capacity, Math.max(0, Math.round(level.value))) };
	}
</script>

<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip';

	const { level, label }: { level: NodeLevel; label?: string } = $props();

	const segments = $derived(slots(level));
	// Without a capacity the full mark is the most held so far, never under ten
	const full = $derived(level.capacity ?? Math.max(10, level.peak));
	const fraction = $derived(Math.min(1, level.value / full));
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<div {...props} class="absolute inset-x-3 bottom-0 flex h-4 items-end pb-1.5">
				{#if segments}
					<div class="flex h-1 w-full gap-0.5">
						{#each { length: segments.count }, i}
							<div
								class="h-full flex-1 rounded-full transition-colors duration-300 {i < segments.lit
									? 'bg-primary'
									: 'bg-muted'}"
							></div>
						{/each}
					</div>
				{:else}
					<div class="h-1 w-full overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-primary transition-[width] duration-300"
							style:width="{fraction * 100}%"
						></div>
					</div>
				{/if}
			</div>
		{/snippet}
	</Tooltip.Trigger>
	{#if label}
		<Tooltip.Content>{label}</Tooltip.Content>
	{/if}
</Tooltip.Root>
