<script module>
	export function getItemNamesInOrder(directory): string[] {
		const directoryNames = Object.keys(directory)
			.filter((itemName) => Object.hasOwn(directory[itemName], 'directory'))
			.sort();
		const fileNames = Object.keys(directory)
			.filter((itemName) => Object.hasOwn(directory[itemName], 'file'))
			.sort();

		return [...directoryNames, ...fileNames];
	}
</script>

<script lang="ts">
	import { draggable, droppable } from '@thisux/sveltednd';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import * as Rename from '$lib/components/ui/rename';
	import FileTree from './FileTree.svelte';

	let {
		selectedFilePath = $bindable(),
		anyItemBeingRenamed = $bindable(),
		item,
		itemName,
		itemType,
		parentPath,
		webContainer,
		handleDrop
	} = $props();

	const itemPath = [...parentPath, itemName];
	let itemRenameMode = $state('view');

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

	function renameItem(newName) {
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
								onSave={renameItem}
								fallbackSelectionBehavior="all"
							/>
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
		<Rename.Provider
			><ContextMenu.Root>
				<ContextMenu.Trigger>
					<TreeView.Folder
						class="
          handle-{itemPath.join('-')}
          w-full
          cursor-pointer
          hover:bg-gray-900"
					>
						{#snippet label()}
							<Rename.Root
								this="span"
								value={itemName}
								bind:mode={itemRenameMode}
								blurBehavior="exit"
								class="flex place-items-center gap-1 pl-0.75"
								onSave={renameItem}
								fallbackSelectionBehavior="all"
							/>
						{/snippet}
						{#each getItemNamesInOrder(item) as childName (childName)}
							<FileTree
								bind:selectedFilePath
								bind:anyItemBeingRenamed
								item={Object.hasOwn(item[childName], 'directory')
									? item[childName].directory
									: item[childName].file}
								itemName={childName}
								itemType={Object.hasOwn(item[childName], 'directory') ? 'directory' : 'file'}
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
			</ContextMenu.Root></Rename.Provider
		>
	</div>
{/if}
