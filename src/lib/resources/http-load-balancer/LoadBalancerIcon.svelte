<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import { cn } from '$lib/utils';

	// Lucide's network branches downward, while the canvas reads left to right
	const { class: className, ...rest }: ComponentProps<typeof NetworkIcon> = $props();
</script>

<NetworkIcon class={cn('-rotate-90', className)} {...rest} />
