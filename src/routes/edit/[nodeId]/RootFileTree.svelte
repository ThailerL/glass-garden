<script lang="ts">
	import { untrack } from 'svelte';
	import type { ClassValue } from 'clsx';
	import type { Vivari } from '@vivari/core';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { cn } from '$lib/utils.js';
	import {
		directoryListing,
		isAtOrUnder,
		rebase,
		setFileTreeContext,
		getFileRefresh,
		getFileDraftState
	} from '$lib/files';
	import FileTree from './FileTree.svelte';
	import { toast } from 'svelte-sonner';

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
	const fileDraftState = getFileDraftState();
	// Both are fixed for the life of the editor, so they are read once rather than tracked
	const listing = untrack(() => directoryListing(container, root));

	async function handleDrop({
		draggedItem,
		sourceContainer,
		targetContainer
	}: DragDropState<string>) {
		const draggedPath = [sourceContainer, draggedItem].filter(Boolean).join('/');
		// directories can't be dragged into itself or a child directory of itself
		if (
			targetContainer === null ||
			sourceContainer === targetContainer ||
			isAtOrUnder(targetContainer, draggedPath)
		) {
			return;
		}

		const movedPath = [targetContainer, draggedItem].filter(Boolean).join('/');
		const from = draggedPath.split('/');
		const to = movedPath.split('/');
		const destinationFsPath = [root, movedPath].join('/');

		async function move() {
			try {
				await container.fs.rename([root, draggedPath].join('/'), destinationFsPath);
			} catch {
				toast.error(`Could not move ${draggedItem}`);
				return;
			}

			fileDraftState.discardPath(to);
			fileDraftState.movePath(from, to);
			selectedFilePath = rebase(selectedFilePath, from, to);

			refresh.bump();
		}

		// Without knowing whether something is already there, the move could silently replace it
		const destination = await container.fs.stat(destinationFsPath).catch(() => undefined);
		if (!destination) {
			toast.error(`Could not move ${draggedItem}`);
			return;
		}
		if (!destination.exists) return move();

		confirmDelete({
			title: `Replace "${draggedItem}"?`,
			description: `${movedPath} already exists. Replacing it deletes ${
				destination.isDirectory ? 'that folder and everything inside it' : 'the file that is there'
			}.`,
			confirm: { text: 'Replace' },
			onConfirm: move
		});
	}

	const tree = untrack(() => setFileTreeContext(container, root, refresh, handleDrop));

	function newFile() {
		void tree.createFile([], listing.names);
	}

	function newFolder() {
		void tree.createFolder([], listing.names);
	}
</script>

<ContextMenu.Root>
	<ContextMenu.Trigger>
		{#snippet child({ props })}
			<!-- bits-ui types the child snippet's props as unknown, so class is cast to what cn
			accepts rather than to the one shape a caller happens to pass -->
			<!-- Choosing a file here focuses its button, so Ctrl+S still reaches the editor -->
			<div
				{...props}
				class={cn(props.class as ClassValue, 'min-h-full')}
				data-save-scope
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
