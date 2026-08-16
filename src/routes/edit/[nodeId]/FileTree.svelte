<script lang="ts">
	import { draggable, droppable } from '@thisux/sveltednd';
	import * as TreeView from '$lib/components/ui/tree-view';
	import FileTree from './FileTree.svelte';

	let { selectedFilePath = $bindable(), currentPath, files, handleDrop } = $props();

	function getItemNamesInOrder(): string[] {
		const directoryNames = Object.keys(files)
			.filter((itemName) => Object.hasOwn(files[itemName], 'directory'))
			.sort();
		const fileNames = Object.keys(files)
			.filter((itemName) => Object.hasOwn(files[itemName], 'file'))
			.sort();

		return [...directoryNames, ...fileNames];
	}
</script>

{#each getItemNamesInOrder() as itemName (itemName)}
	{#if Object.hasOwn(files[itemName], 'file')}
		<div
			class="hover:bg-gray-900"
			use:draggable={{
				container: currentPath.join('/'),
				dragData: itemName
			}}
		>
			{#if selectedFilePath.length === [...currentPath, itemName].length && selectedFilePath.every((val, i) => val === [...currentPath, itemName][i])}
				<TreeView.File
					class="w-full bg-gray-600"
					name={itemName}
					onclick={() => (selectedFilePath = [...currentPath, itemName])}
				/>
			{:else}
				<TreeView.File
					class="w-full"
					name={itemName}
					onclick={() => (selectedFilePath = [...currentPath, itemName])}
				/>
			{/if}
		</div>
	{:else if Object.hasOwn(files[itemName], 'directory')}
		<div
			use:droppable={{
				container: [...currentPath, itemName].join('/'),
				callbacks: { onDrop: handleDrop }
			}}
		>
			<TreeView.Folder class="w-full hover:bg-gray-900" name={itemName}>
				<FileTree
					bind:selectedFilePath
					currentPath={[...currentPath, itemName]}
					files={files[itemName].directory}
					{handleDrop}
				/>
			</TreeView.Folder>
		</div>
	{/if}
{/each}
