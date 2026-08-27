<script lang="ts">
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import { cn } from '$lib/utils.js';
	import type { TreeViewFolderProps } from '$lib/components/ui/tree-view/types';

	let {
		name = '',
		open = $bindable(true),
		class: className,
		icon,
		label,
		children
	}: TreeViewFolderProps = $props();
</script>

<Collapsible.Root bind:open>
	<Collapsible.Trigger class={cn('flex place-items-center gap-1 text-left', className)}>
		{#if icon}
			{@render icon({ name, open })}
		{:else if open}
			<FolderOpenIcon class="size-4 shrink-0" />
		{:else}
			<FolderIcon class="size-4 shrink-0" />
		{/if}
		{#if label}
			{@render label()}
		{:else}
			<span>{name}</span>
		{/if}
	</Collapsible.Trigger>
	<Collapsible.Content class="ml-2 border-l">
		<div class="relative flex place-items-start">
			<div class="mx-2 h-full w-px bg-border"></div>
			<div class="flex flex-1 flex-col">
				{@render children?.()}
			</div>
		</div>
	</Collapsible.Content>
</Collapsible.Root>
