<script lang="ts">
	import FileIcon from '@lucide/svelte/icons/file';
	import { cn } from '$lib/utils.js';
	import type { TreeViewFileProps } from '$lib/components/ui/tree-view/types';

	let {
		name = '',
		icon,
		children,
		type = 'button',
		class: className,
		...rest
	}: TreeViewFileProps = $props();
</script>

<button {type} class={cn('flex place-items-center gap-1 pl-[3px]', className)} {...rest}>
	{#if icon}
		{@render icon({ name })}
	{:else}
		<FileIcon class="size-4" />
	{/if}
	{#if children}
		{@render children()}
	{:else}
		<span>{name}</span>
	{/if}
</button>
