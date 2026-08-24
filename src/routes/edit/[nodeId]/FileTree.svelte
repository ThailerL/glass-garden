<script module>
	import type { FileSystemTree, DirectoryNode, FileNode, SymlinkNode } from '@webcontainer/api';

	export function getItemNamesInOrder(directory: FileSystemTree): string[] {
		const directoryNames = Object.keys(directory)
			.filter((itemName) => Object.hasOwn(directory[itemName], 'directory'))
			.sort();
		const fileNames = Object.keys(directory)
			.filter((itemName) => Object.hasOwn(directory[itemName], 'file'))
			.sort();

		return [...directoryNames, ...fileNames];
	}

	export function getFileContents(tree: FileSystemTree, path: string[]): string | undefined {
		let node: DirectoryNode | FileNode | SymlinkNode | undefined = tree[path[0]];
		for (let i = 1; i < path.length; i++) {
			if (!node || !('directory' in node)) {
				return undefined;
			}
			node = node.directory[path[i]];
		}
		if (
			!node ||
			!('file' in node) ||
			!('contents' in node.file) ||
			typeof node.file.contents !== 'string'
		) {
			return undefined;
		}
		return node.file.contents;
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { draggable, droppable, type DragDropState } from '@thisux/sveltednd';
	import type { WebContainer } from '@webcontainer/api';
	import UnsavedIcon from '@lucide/svelte/icons/circle-dashed';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as Rename from '$lib/components/ui/rename';
	import FileTree from './FileTree.svelte';
	import { getFileDraftState } from '$lib/file-draft-state.svelte';

	let {
		selectedFilePath = $bindable(),
		anyItemBeingRenamed = $bindable(),
		item,
		itemName,
		itemType,
		parentDirectory,
		parentPath,
		webContainer,
		handleDrop
	}: {
		selectedFilePath: string[];
		anyItemBeingRenamed: boolean;
		item: FileSystemTree | FileNode['file'] | SymlinkNode['file'];
		itemName: string;
		itemType: 'file' | 'directory';
		parentDirectory: FileSystemTree;
		parentPath: string[];
		webContainer: WebContainer;
		handleDrop: (state: DragDropState<string>) => void;
	} = $props();

	const fileDraftState = getFileDraftState();

	const itemPath = untrack(() => [...parentPath, itemName]);
	let itemRenameMode = $state<'view' | 'edit'>('view');

	$effect(() => {
		anyItemBeingRenamed = itemRenameMode === 'edit';
	});

	function newFile() {
		let i = 1;
		while (Object.hasOwn(item, `new-file-${i}`)) {
			i++;
		}
		webContainer.fs.writeFile([...itemPath, `new-file-${i}`].join('/'), '');
	}

	function newFolder() {
		let i = 1;
		while (Object.hasOwn(item, `new-folder-${i}`)) {
			i++;
		}
		webContainer.fs.mkdir([...itemPath, `new-folder-${i}`].join('/'));
	}

	function validateName(newName: string) {
		return (
			newName.trim() !== '' && (!Object.hasOwn(parentDirectory, newName) || newName === itemName)
		);
	}
	function renameItem(newName: string) {
		webContainer.fs.rename(itemPath.join('/'), [...parentPath, newName].join('/'));
	}

	function deleteItem() {
		webContainer.fs.rm(itemPath.join('/'), { recursive: true });
	}
</script>

{#if itemType === 'file'}
	<div
		class="hover:bg-gray-900"
		use:draggable={{
			container: parentPath.join('/'),
			dragData: itemName,
			disabled: anyItemBeingRenamed
		}}
	>
		<Rename.Provider>
			<ContextMenu.Root>
				<ContextMenu.Trigger>
					{@const highlightSelected =
						selectedFilePath.length === itemPath.length &&
						selectedFilePath.every((val, i) => val === itemPath[i])
							? 'bg-gray-500'
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
								validate={validateName}
								onSave={renameItem}
								fallbackSelectionBehavior="all"
							/>
							{#if fileDraftState.isDirty(itemPath)}
								<UnsavedIcon />
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
{:else if itemType === 'directory'}
	{@const directory = item as FileSystemTree}
	<div
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
				<ContextMenu.Trigger>
					<TreeView.Folder
						open={false}
						class="handle-{itemPath.join('-')} w-full cursor-pointer hover:bg-gray-900"
					>
						{#snippet label()}
							<Rename.Root
								this="span"
								value={itemName}
								bind:mode={itemRenameMode}
								blurBehavior="exit"
								class="flex place-items-center gap-1 pl-0.75"
								validate={validateName}
								onSave={renameItem}
								fallbackSelectionBehavior="all"
							/>
							{#if fileDraftState.containsDirty(itemPath)}
								<UnsavedIcon />
							{/if}
						{/snippet}
						{#each getItemNamesInOrder(directory) as childName (childName)}
							<FileTree
								bind:selectedFilePath
								bind:anyItemBeingRenamed
								item={'directory' in directory[childName]
									? directory[childName].directory
									: directory[childName].file}
								itemName={childName}
								itemType={'directory' in directory[childName] ? 'directory' : 'file'}
								parentDirectory={directory}
								parentPath={itemPath}
								{webContainer}
								{handleDrop}
							/>
						{/each}
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
{/if}
