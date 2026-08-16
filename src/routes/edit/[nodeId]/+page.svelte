<script lang="ts">
	import { WebContainer } from '@webcontainer/api';
	import { page } from '$app/state';
	import * as TreeView from '$lib/components/ui/tree-view';
	import { getNodeFromLocalStorage } from '$lib/utils';
	import Terminal from '$lib/components/Terminal.svelte';
	import FileTree from './FileTree.svelte';
	import TextArea from './TextArea.svelte';
	import { onMount } from 'svelte';

	const node = getNodeFromLocalStorage(page.params.nodeId);
	let selectedFilePath = $state([]);

	let webContainer = $state<WebContainer>();

	onMount(async () => {
		webContainer = await WebContainer.boot();
		webContainer.on('server-ready', (port, url) => {
			console.log(port);
			console.log(url);
		});
		webContainer.mount(node?.data.files);
	});
</script>

<svelte:head>
	<title>Editing {node?.data.name}</title>
</svelte:head>

{#if node}
	<div class="flex h-dvh w-screen">
		<div class="h-full w-1/7 bg-gray-950">
			<TreeView.Root>
				<FileTree bind:selectedFilePath currentPath={[]} files={node?.data.files} />
			</TreeView.Root>
		</div>
		<div class="flex flex-1 flex-col">
			<div class="h-3/5">
				<TextArea {webContainer} {node} {selectedFilePath} />
			</div>
			<div class="flex-1 bg-black">
				<Terminal {webContainer} />
			</div>
		</div>
	</div>
{:else}
	Node not found
{/if}
