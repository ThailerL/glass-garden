<script lang="ts">
	import type { Vivari, FileSystemTree } from '@vivari/core';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import { cn } from '$lib/utils.js';
	import { getItemNamesInOrder, createFile, createFolder } from '$lib/file-tree';
	import FileTree from './FileTree.svelte';
	import { getFileRefresh } from '$lib/file-refresh';

	let {
		selectedFilePath = $bindable(),
		files,
		root,
		container
	}: {
		selectedFilePath: string[];
		files: FileSystemTree;
		root: string;
		container: Vivari;
	} = $props();

	let anyItemBeingRenamed = $state(false);

	const refreshFiles = getFileRefresh();

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
			.then(refreshFiles);

		const sourcePath = sourceContainer === '' ? [] : sourceContainer.split('/');
		const targetPath = targetContainer === '' ? [] : targetContainer.split('/');
		if (selectedFilePath.join('/') === [...sourcePath, draggedItem].join('/')) {
			selectedFilePath = [...targetPath, draggedItem];
		}
	}

	function newFile() {
		createFile(container, files, root).then(refreshFiles);
	}

	function newFolder() {
		createFolder(container, files, root).then(refreshFiles);
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
					{#each getItemNamesInOrder(files) as itemName (itemName)}
						<FileTree
							bind:selectedFilePath
							bind:anyItemBeingRenamed
							node={files[itemName]}
							{itemName}
							parentDirectory={files}
							parentPath={[]}
							{root}
							{container}
							{handleDrop}
						/>
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
