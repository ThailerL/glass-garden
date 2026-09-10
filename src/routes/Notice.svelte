<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	const {
		icon: Icon,
		title,
		children
	}: { icon: Component<{ class?: string }>; title: string; children?: Snippet } = $props();
</script>

<div class="flex h-dvh items-center justify-center p-6">
	<div class="flex max-w-sm flex-col items-center gap-3 text-center">
		<Icon class="size-8 text-muted-foreground" />
		<h1 class="text-lg font-semibold">{title}</h1>
		{@render children?.()}
	</div>
</div>
