<script lang="ts">
	import { untrack } from 'svelte';
	import type { Vivari } from '@vivari/core';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import { cn } from '$lib/utils.js';
	import { createFile, createFolder, directoryListing } from '$lib/file-tree.svelte';
	import { setFileTreeContext } from '$lib/file-tree-context.svelte';
	import FileTree from './FileTree.svelte';
	import { getFileRefresh } from '$lib/file-refresh.svelte';

	let {
		selectedFilePath = $bindable(),
		root,
		container
	}: {
		selectedFilePath: string[];
		root: string;
		container: Vivari;
	} = $props();

	const refresh = getFileRefresh();
	// Both are fixed for the life of the editor, so they are read once rather than tracked
	const listing = untrack(() => directoryListing(container, root));

	function handleDrop({ draggedItem, sourceContainer, targetContainer }: DragDropState<string>) {
		// directories can't be dragged into itself or a child directory of itself
		if (
			targetContainer === null ||
			sourceContainer === targetContainer ||
			targetContainer.startsWith(
				sourceContainer === '' ? draggedItem : [sourceContainer, draggedItem].join('/')
			)
		) {
			return;
		}

		container.fs
			.rename(
				[root, sourceContainer, draggedItem].filter(Boolean).join('/'),
				[root, targetContainer, draggedItem].filter(Boolean).join('/')
			)
			// Both the source and the target listing are stale now, and neither of them is the
			// one that ran this handler
			.then(() => refresh.bump());

		const sourcePath = sourceContainer === '' ? [] : sourceContainer.split('/');
		const targetPath = targetContainer === '' ? [] : targetContainer.split('/');
		if (selectedFilePath.join('/') === [...sourcePath, draggedItem].join('/')) {
			selectedFilePath = [...targetPath, draggedItem];
		}
	}

	untrack(() => setFileTreeContext(container, root, handleDrop));

	function newFile() {
		createFile(container, listing.names, root).then(() => refresh.bump());
	}

	function newFolder() {
		createFolder(container, listing.names, root).then(() => refresh.bump());
	}
</script>

<ContextMenu.Root>
	<ContextMenu.Trigger>
		{#snippet child({ props })}
			<div
				{...props}
				class={cn(props.class as string, 'min-h-full')}
				use:droppable={{ container: '', callbacks: { onDrop: handleDrop } }}
			>
				<TreeView.Root>
					{#each listing.entries as entry (entry.name)}
						<FileTree bind:selectedFilePath {entry} siblingNames={listing.names} parentPath={[]} />
					{/each}
				</TreeView.Root>
			</div>
		{/snippet}
	</ContextMenu.Trigger>
	<ContextMenu.Content>
		<ContextMenu.Item onSelect={newFile}>New File</ContextMenu.Item>
		<ContextMenu.Item onSelect={newFolder}>New Folder</ContextMenu.Item>
	</ContextMenu.Content>
</ContextMenu.Root>
