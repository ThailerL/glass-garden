<script lang="ts">
	import * as TreeView from '$lib/components/ui/tree-view';
	import FileTree from './FileTree.svelte';
	let { selectedFilePath = $bindable(), currentPath, files } = $props();
</script>

{#each Object.keys(files) as itemName (itemName)}
	{#if Object.hasOwn(files[itemName], 'file')}
		{#if selectedFilePath.length === [...currentPath, itemName].length && selectedFilePath.every((val, i) => val === [...currentPath, itemName][i])}
			<TreeView.File
				name={itemName}
				onclick={() => (selectedFilePath = [...currentPath, itemName])}
				class="bg-blue-200"
			/>
		{:else}
			<TreeView.File
				name={itemName}
				onclick={() => (selectedFilePath = [...currentPath, itemName])}
			/>
		{/if}
	{:else if Object.hasOwn(files[itemName], 'directory')}
		<TreeView.Folder name={itemName}>
			<FileTree
				bind:selectedFilePath
				currentPath={[...currentPath, itemName]}
				files={files[itemName].directory}
			/>
		</TreeView.Folder>
	{/if}
{/each}
