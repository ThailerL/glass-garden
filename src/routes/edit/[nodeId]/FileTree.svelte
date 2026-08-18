<script lang="ts">
	import { draggable, droppable } from '@thisux/sveltednd';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import FileTree from './FileTree.svelte';

	let { selectedFilePath = $bindable(), currentPath, files, webContainer, handleDrop } = $props();

	function getItemNamesInOrder(): string[] {
		const directoryNames = Object.keys(files)
			.filter((itemName) => Object.hasOwn(files[itemName], 'directory'))
			.sort();
		const fileNames = Object.keys(files)
			.filter((itemName) => Object.hasOwn(files[itemName], 'file'))
			.sort();

		return [...directoryNames, ...fileNames];
	}

	function newFile(dirName) {
		let i = 1;
		while (Object.hasOwn(files[dirName].directory, `new-file-${i}`)) {
			i++;
		}
		webContainer.fs.writeFile([...currentPath, dirName, `new-file-${i}`].join('/'), '');
	}

	function newFolder(dirName) {
		let i = 1;
		while (Object.hasOwn(files[dirName].directory, `new-folder-${i}`)) {
			i++;
		}
		webContainer.fs.mkdir([...currentPath, dirName, `new-folder-${i}`].join('/'));
	}

	function deleteItem(itemName) {
		webContainer.fs.rm([...currentPath, itemName].join('/'), { recursive: true });
	}
</script>

{#each getItemNamesInOrder() as itemName (itemName)}
	{@const itemPath = [...currentPath, itemName]}
	{#if Object.hasOwn(files[itemName], 'file')}
		<div
			class="hover:bg-gray-900"
			use:draggable={{
				container: currentPath.join('/'),
				dragData: itemName
			}}
		>
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
						onclick={() => (selectedFilePath = itemPath)}
					/>
				</ContextMenu.Trigger>
				<ContextMenu.Content>
					<ContextMenu.Item onSelect={() => deleteItem(itemName)}>Delete</ContextMenu.Item>
				</ContextMenu.Content>
			</ContextMenu.Root>
		</div>
	{:else if Object.hasOwn(files[itemName], 'directory')}
		<div
			use:draggable={{
				container: currentPath.join('/'),
				dragData: itemName,
				// Makes it so that when children are dragged no event triggers on parent folders
				handle: `.handle-${itemPath.join('-')}`
			}}
			use:droppable={{
				container: itemPath.join('/'),
				callbacks: { onDrop: handleDrop }
			}}
		>
			<ContextMenu.Root>
				<ContextMenu.Trigger>
					<TreeView.Folder
						class="
          handle-{itemPath.join('-')}
          w-full
          cursor-pointer
          hover:bg-gray-900"
						name={itemName}
					>
						<FileTree
							bind:selectedFilePath
							currentPath={itemPath}
							files={files[itemName].directory}
							{webContainer}
							{handleDrop}
						/>
					</TreeView.Folder>
				</ContextMenu.Trigger>
				<ContextMenu.Content>
					<ContextMenu.Item onSelect={() => newFile(itemName)}>New File</ContextMenu.Item>
					<ContextMenu.Item onSelect={() => newFolder(itemName)}>New Folder</ContextMenu.Item>
					<ContextMenu.Item onSelect={() => deleteItem(itemName)}>Delete</ContextMenu.Item>
				</ContextMenu.Content>
			</ContextMenu.Root>
		</div>
	{/if}
{/each}
