<script lang="ts">
	import type { Vivari, DirEnt } from '@vivari/core';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import { cn } from '$lib/utils.js';
	import { listDirectory, createFile, createFolder } from '$lib/file-tree';
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

	let anyItemBeingRenamed = $state(false);

	const refresh = getFileRefresh();

	let entries = $state<DirEnt[]>([]);
	// The revision the listing was read at, so a slow read can't land on top of a newer one
	let listedRevision = -1;

	$effect(() => {
		const revision = refresh.revision;
		listDirectory(container, root).then((result) => {
			if (revision < listedRevision) return;
			listedRevision = revision;
			entries = result;
		});
	});

	const entryNames = $derived(entries.map((entry) => entry.name));

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

	function newFile() {
		createFile(container, entryNames, root).then(() => refresh.bump());
	}

	function newFolder() {
		createFolder(container, entryNames, root).then(() => refresh.bump());
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
					{#each entries as entry (entry.name)}
						<FileTree
							bind:selectedFilePath
							bind:anyItemBeingRenamed
							{entry}
							siblingNames={entryNames}
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
