<script lang="ts">
	import type { WebContainer, FileSystemTree } from '@webcontainer/api';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import { cn } from '$lib/utils.js';
	import { getItemNamesInOrder, createFile, createFolder } from '$lib/file-tree';
	import FileTree from './FileTree.svelte';

	let {
		selectedFilePath = $bindable(),
		files,
		root,
		webContainer
	}: {
		selectedFilePath: string[];
		files: FileSystemTree;
		root: string;
		webContainer: WebContainer;
	} = $props();

	let anyItemBeingRenamed = $state(false);

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

		webContainer.fs.rename(
			[root, sourceContainer, draggedItem].filter(Boolean).join('/'),
			[root, targetContainer, draggedItem].filter(Boolean).join('/')
		);

		const sourcePath = sourceContainer === '' ? [] : sourceContainer.split('/');
		const targetPath = targetContainer === '' ? [] : targetContainer.split('/');
		if (selectedFilePath.join('/') === [...sourcePath, draggedItem].join('/')) {
			selectedFilePath = [...targetPath, draggedItem];
		}
	}

	function newFile() {
		createFile(webContainer, files, root);
	}

	function newFolder() {
		createFolder(webContainer, files, root);
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
							{webContainer}
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
