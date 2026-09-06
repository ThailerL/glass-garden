<script lang="ts">
	import type { NodeLevel } from '$lib/traffic.svelte';

	const { level }: { level: NodeLevel } = $props();

	// Without a capacity the full mark is the most held so far, never under ten
	const full = $derived(level.capacity ?? Math.max(10, level.peak));
	const fraction = $derived(Math.min(1, level.value / full));
</script>

<!-- A level, never a number: a number would be read against the Metrics tab's statistic -->
<div class="absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-full bg-muted">
	<div
		class="h-full rounded-full bg-primary transition-[width] duration-300"
		style:width="{fraction * 100}%"
	></div>
</div>
