<script lang="ts">
	import { untrack } from 'svelte';
	import { draggable, droppable } from '@thisux/sveltednd';
	import type { DirEnt } from '@vivari/core';
	import UnsavedIcon from '@lucide/svelte/icons/circle-dashed';
	import {
		directoryListing,
		isAtOrUnder,
		rebase,
		getFileTreeContext,
		getFileDraftState,
		getFileRefresh
	} from '$lib/files';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as Rename from '$lib/components/ui/rename';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import FileTree from './FileTree.svelte';
	import { toast } from 'svelte-sonner';

	let {
		selectedFilePath = $bindable(),
		entry,
		siblingNames,
		parentPath
	}: {
		selectedFilePath: string[];
		entry: DirEnt;
		siblingNames: string[];
		parentPath: string[];
	} = $props();

	const fileDraftState = getFileDraftState();
	const refresh = getFileRefresh();
	const tree = getFileTreeContext();

	const itemName = untrack(() => entry.name);
	const itemPath = untrack(() => [...parentPath, itemName]);
	const itemKey = itemPath.join('/');

	// A closed folder never reads its own contents, which is what keeps opening the editor
	// from walking the entire node
	let open = $state(false);
	const listing = directoryListing(tree.container, tree.fsPath(itemPath), () => open);

	let itemRenameMode = $state<'view' | 'edit'>('view');

	$effect(() => {
		if (itemRenameMode === 'edit') tree.renamingPath = itemKey;
		// Cleared only by the node that owns it, so mounting mid-rename can't cancel one
		else if (tree.renamingPath === itemKey) tree.renamingPath = undefined;
	});

	// A node deleted while being renamed would otherwise leave the whole tree undraggable
	$effect(() => () => {
		if (tree.renamingPath === itemKey) tree.renamingPath = undefined;
	});

	function newFile() {
		void tree.createFile(itemPath, listing.names);
	}

	function newFolder() {
		void tree.createFolder(itemPath, listing.names);
	}

	function validateName(newName: string) {
		return newName.trim() !== '' && (!siblingNames.includes(newName) || newName === itemName);
	}

	async function renameItem(newName: string) {
		const renamedPath = [...parentPath, newName];
		try {
			await tree.container.fs.rename(tree.fsPath(itemPath), tree.fsPath(renamedPath));
		} catch {
			toast.error(`Could not rename ${itemName}`);
			return;
		}

		// Drafts and the selection are keyed by path, so both follow the item that moved
		fileDraftState.movePath(itemPath, renamedPath);
		selectedFilePath = rebase(selectedFilePath, itemPath, renamedPath);
		refresh.bump();
	}

	function confirmDeleteItem() {
		confirmDelete({
			title: `Delete "${itemName}"?`,
			description: entry.isDirectory()
				? 'Deletes this folder and everything inside it.'
				: 'Deletes this file.',
			onConfirm: deleteItem
		});
	}

	async function deleteItem() {
		try {
			await tree.container.fs.rm(tree.fsPath(itemPath), { recursive: true });
		} catch {
			toast.error(`Could not delete ${itemName}`);
			return;
		}

		fileDraftState.discardPath(itemPath);
		// The open file is this item or lives inside it, so the delete invalidates the selected
		// path - which a save would otherwise write to, recreating what was just removed
		if (isAtOrUnder(selectedFilePath.join('/'), itemKey)) selectedFilePath = [];
		refresh.bump();
	}
</script>

{#if entry.isDirectory()}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		ondragstart={(event) => event.stopPropagation()}
		use:draggable={{
			container: parentPath.join('/'),
			dragData: itemName,
			disabled: tree.anyItemBeingRenamed,
			// Makes it so that when children are dragged no event triggers on parent folders
			handle: `.handle-${itemPath.join('-')}`
		}}
		use:droppable={{
			container: itemKey,
			callbacks: { onDrop: tree.onDrop }
		}}
	>
		<Rename.Provider>
			<ContextMenu.Root>
				<ContextMenu.Trigger oncontextmenu={(event) => event.stopPropagation()}>
					<TreeView.Folder
						bind:open
						class={[
							`handle-${itemPath.join('-')}`,
							'w-full cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
						]}
					>
						{#snippet label()}
							<Rename.Root
								this="span"
								value={itemName}
								bind:mode={itemRenameMode}
								blurBehavior="exit"
								class="flex place-items-center gap-1 pl-0.75"
								textClass="block truncate"
								validate={validateName}
								onSave={renameItem}
								fallbackSelectionBehavior="all"
							/>
							{#if fileDraftState.containsDirty(itemPath)}
								<UnsavedIcon class="size-3.5 shrink-0" />
							{/if}
						{/snippet}
						<!-- Collapsible.Content keeps its children mounted, so the recursion has to be
						gated here or every folder would list itself on mount -->
						{#if open}
							{#each listing.entries as child (child.name)}
								<FileTree
									bind:selectedFilePath
									entry={child}
									siblingNames={listing.names}
									parentPath={itemPath}
								/>
							{/each}
						{/if}
					</TreeView.Folder>
				</ContextMenu.Trigger>
				<ContextMenu.Content>
					<ContextMenu.Item onSelect={newFile}>New File</ContextMenu.Item>
					<ContextMenu.Item onSelect={newFolder}>New Folder</ContextMenu.Item>
					<ContextMenu.Separator />
					<Rename.Edit>
						{#snippet child({ edit })}
							<ContextMenu.Item onSelect={edit}>Rename</ContextMenu.Item>
						{/snippet}
					</Rename.Edit>
					<ContextMenu.Item onSelect={confirmDeleteItem}>Delete</ContextMenu.Item>
				</ContextMenu.Content>
			</ContextMenu.Root>
		</Rename.Provider>
	</div>
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
		ondragstart={(event) => event.stopPropagation()}
		use:draggable={{
			container: parentPath.join('/'),
			dragData: itemName,
			disabled: tree.anyItemBeingRenamed
		}}
	>
		<Rename.Provider>
			<ContextMenu.Root>
				<ContextMenu.Trigger oncontextmenu={(event) => event.stopPropagation()}>
					<TreeView.File
						class={[
							'w-full cursor-pointer',
							selectedFilePath.join('/') === itemKey &&
								'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
						]}
						name={itemName}
						editing={itemRenameMode === 'edit'}
						onclick={() => {
							if (itemRenameMode === 'view') selectedFilePath = itemPath;
						}}
					>
						{#snippet label()}
							<Rename.Root
								this="span"
								value={itemName}
								bind:mode={itemRenameMode}
								blurBehavior="exit"
								class="flex place-items-center gap-1 pl-0.75"
								textClass="block truncate"
								validate={validateName}
								onSave={renameItem}
								fallbackSelectionBehavior="all"
							/>
							{#if fileDraftState.isDirty(itemPath)}
								<UnsavedIcon class="size-3.5 shrink-0" />
							{/if}
						{/snippet}
					</TreeView.File>
				</ContextMenu.Trigger>
				<ContextMenu.Content>
					<Rename.Edit>
						{#snippet child({ edit })}
							<ContextMenu.Item onSelect={edit}>Rename</ContextMenu.Item>
						{/snippet}
					</Rename.Edit>
					<ContextMenu.Item onSelect={confirmDeleteItem}>Delete</ContextMenu.Item>
				</ContextMenu.Content>
			</ContextMenu.Root>
		</Rename.Provider>
	</div>
{/if}
