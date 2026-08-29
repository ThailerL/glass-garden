<script lang="ts">
	import { untrack } from 'svelte';
	import { draggable, droppable, type DragDropState } from '@thisux/sveltednd';
	import type { Vivari, DirEnt } from '@vivari/core';
	import UnsavedIcon from '@lucide/svelte/icons/circle-dashed';
	import { listDirectory, createFile, createFolder } from '$lib/file-tree';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as Rename from '$lib/components/ui/rename';
	import FileTree from './FileTree.svelte';
	import { getFileDraftState } from '$lib/file-draft-state.svelte';
	import { getFileRefresh } from '$lib/file-refresh.svelte';

	let {
		selectedFilePath = $bindable(),
		anyItemBeingRenamed = $bindable(),
		entry,
		siblingNames,
		parentPath,
		root,
		container,
		handleDrop
	}: {
		selectedFilePath: string[];
		anyItemBeingRenamed: boolean;
		entry: DirEnt;
		siblingNames: string[];
		parentPath: string[];
		root: string;
		container: Vivari;
		handleDrop: (state: DragDropState<string>) => void;
	} = $props();

	const fileDraftState = getFileDraftState();
	const refresh = getFileRefresh();

	const itemName = untrack(() => entry.name);
	const itemPath = untrack(() => [...parentPath, itemName]);

	function fsPath(path: string[]) {
		return [root, ...path].join('/');
	}

	// A closed folder never reads its own contents, which is what keeps opening the editor
	// from walking the entire node
	let open = $state(false);
	let entries = $state<DirEnt[]>([]);
	// The revision the listing was read at, so a slow read can't land on top of a newer one
	let listedRevision = -1;

	$effect(() => {
		if (!open) return;
		const revision = refresh.revision;
		listDirectory(container, fsPath(itemPath)).then((result) => {
			if (revision < listedRevision) return;
			listedRevision = revision;
			entries = result;
		});
	});

	const entryNames = $derived(entries.map((child) => child.name));

	let itemRenameMode = $state<'view' | 'edit'>('view');

	$effect(() => {
		anyItemBeingRenamed = itemRenameMode === 'edit';
	});

	function newFile() {
		createFile(container, entryNames, fsPath(itemPath)).then(() => refresh.bump());
	}

	function newFolder() {
		createFolder(container, entryNames, fsPath(itemPath)).then(() => refresh.bump());
	}

	function validateName(newName: string) {
		return newName.trim() !== '' && (!siblingNames.includes(newName) || newName === itemName);
	}

	function renameItem(newName: string) {
		container.fs
			.rename(fsPath(itemPath), fsPath([...parentPath, newName]))
			.then(() => refresh.bump());
	}

	function deleteItem() {
		container.fs.rm(fsPath(itemPath), { recursive: true }).then(() => refresh.bump());
	}
</script>

{#if entry.isDirectory()}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		ondragstart={(event) => event.stopPropagation()}
		use:draggable={{
			container: parentPath.join('/'),
			dragData: itemName,
			disabled: anyItemBeingRenamed,
			// Makes it so that when children are dragged no event triggers on parent folders
			handle: `.handle-${itemPath.join('-')}`
		}}
		use:droppable={{
			container: itemPath.join('/'),
			callbacks: { onDrop: handleDrop }
		}}
	>
		<Rename.Provider>
			<ContextMenu.Root>
				<ContextMenu.Trigger oncontextmenu={(event) => event.stopPropagation()}>
					<TreeView.Folder
						bind:open
						class="handle-{itemPath.join(
							'-'
						)} w-full cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
							{#each entries as child (child.name)}
								<FileTree
									bind:selectedFilePath
									bind:anyItemBeingRenamed
									entry={child}
									siblingNames={entryNames}
									parentPath={itemPath}
									{root}
									{container}
									{handleDrop}
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
					<ContextMenu.Item onSelect={deleteItem}>Delete</ContextMenu.Item>
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
			disabled: anyItemBeingRenamed
		}}
	>
		<Rename.Provider>
			<ContextMenu.Root>
				<ContextMenu.Trigger oncontextmenu={(event) => event.stopPropagation()}>
					{@const highlightSelected =
						selectedFilePath.join('/') === itemPath.join('/')
							? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
							: ''}
					<TreeView.File
						class="w-full cursor-pointer {highlightSelected}"
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
					<ContextMenu.Item onSelect={deleteItem}>Delete</ContextMenu.Item>
				</ContextMenu.Content>
			</ContextMenu.Root>
		</Rename.Provider>
	</div>
{/if}
