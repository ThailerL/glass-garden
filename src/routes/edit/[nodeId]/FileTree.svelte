<script lang="ts">
	import { untrack } from 'svelte';
	import { draggable, droppable, type DragDropState } from '@thisux/sveltednd';
	import type {
		WebContainer,
		FileSystemTree,
		DirectoryNode,
		FileNode,
		SymlinkNode
	} from '@webcontainer/api';
	import UnsavedIcon from '@lucide/svelte/icons/circle-dashed';
	import { getItemNamesInOrder, createFile, createFolder } from '$lib/file-tree';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as Rename from '$lib/components/ui/rename';
	import FileTree from './FileTree.svelte';
	import { getFileDraftState } from '$lib/file-draft-state.svelte';

	let {
		selectedFilePath = $bindable(),
		anyItemBeingRenamed = $bindable(),
		node,
		itemName,
		parentDirectory,
		parentPath,
		root,
		webContainer,
		handleDrop
	}: {
		selectedFilePath: string[];
		anyItemBeingRenamed: boolean;
		node: DirectoryNode | FileNode | SymlinkNode;
		itemName: string;
		parentDirectory: FileSystemTree;
		parentPath: string[];
		root: string;
		webContainer: WebContainer;
		handleDrop: (state: DragDropState<string>) => void;
	} = $props();

	const fileDraftState = getFileDraftState();

	const itemPath = untrack(() => [...parentPath, itemName]);

	function fsPath(path: string[]) {
		return [root, ...path].join('/');
	}
	let itemRenameMode = $state<'view' | 'edit'>('view');

	$effect(() => {
		anyItemBeingRenamed = itemRenameMode === 'edit';
	});

	function newFile(directory: FileSystemTree) {
		createFile(webContainer, directory, fsPath(itemPath));
	}

	function newFolder(directory: FileSystemTree) {
		createFolder(webContainer, directory, fsPath(itemPath));
	}

	function validateName(newName: string) {
		return (
			newName.trim() !== '' && (!Object.hasOwn(parentDirectory, newName) || newName === itemName)
		);
	}
	function renameItem(newName: string) {
		webContainer.fs.rename(fsPath(itemPath), fsPath([...parentPath, newName]));
	}

	function deleteItem() {
		webContainer.fs.rm(fsPath(itemPath), { recursive: true });
	}
</script>

{#if 'directory' in node}
	{@const directory = node.directory}
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
						open={false}
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
						{#each getItemNamesInOrder(directory) as childName (childName)}
							<FileTree
								bind:selectedFilePath
								bind:anyItemBeingRenamed
								node={directory[childName]}
								itemName={childName}
								parentDirectory={directory}
								parentPath={itemPath}
								{root}
								{webContainer}
								{handleDrop}
							/>
						{/each}
					</TreeView.Folder>
				</ContextMenu.Trigger>
				<ContextMenu.Content>
					<ContextMenu.Item onSelect={() => newFile(directory)}>New File</ContextMenu.Item>
					<ContextMenu.Item onSelect={() => newFolder(directory)}>New Folder</ContextMenu.Item>
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
