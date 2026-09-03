<script lang="ts">
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { cn } from '$lib/utils.js';
	import type { ComponentProps } from 'svelte';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: ComponentProps<typeof Separator> = $props();
</script>

<!-- Unprefixed w-auto loses to the primitive's data-[orientation=horizontal]:w-full, which with
mx-2 makes the separator wider than the sidebar and lets it scroll sideways -->
<Separator
	bind:ref
	data-slot="sidebar-separator"
	data-sidebar="separator"
	class={cn('mx-2 bg-sidebar-border data-[orientation=horizontal]:w-auto', className)}
	{...restProps}
/>
