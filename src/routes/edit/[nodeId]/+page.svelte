<script lang="ts">
	import { page } from '$app/state';
	import * as TreeView from '$lib/components/ui/tree-view';
	import { getNodeFromLocalStorage } from '$lib/utils';
	import FileTree from './FileTree.svelte';
	import TextArea from './TextArea.svelte';

	const node = getNodeFromLocalStorage(page.params.nodeId);
	let selectedFilePath = $state([]);
</script>

<svelte:head>
	<title>Editing {node?.data.name}</title>
</svelte:head>

{#if node}
	<div class="flex h-full w-full">
		<TreeView.Root>
			<FileTree bind:selectedFilePath currentPath={[]} files={node?.data.files} />
		</TreeView.Root>
		<TextArea {node} {selectedFilePath} />
	</div>
{:else}
	Node does not exist
{/if}
