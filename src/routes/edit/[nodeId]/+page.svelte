<script lang="ts">
	import { WebContainer, type FileSystemTree } from '@webcontainer/api';
	import { onMount } from 'svelte';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import { page } from '$app/state';
	import * as TreeView from '$lib/components/ui/tree-view';
	import { getNodeFromLocalStorage, setNodeInLocalStorage } from '$lib/utils';
	import Terminal from '$lib/components/Terminal.svelte';
	import FileTree from './FileTree.svelte';
	import TextArea from './TextArea.svelte';

	const node = $state(getNodeFromLocalStorage(page.params.nodeId));
	const files = $state(node?.data.files as FileSystemTree);
	const tempFiles = $state($state.snapshot(files));
	let selectedFilePath = $state<string[]>([]);

	let webContainer = $state<WebContainer>();

	onMount(async () => {
		webContainer = await WebContainer.boot();
		webContainer.on('server-ready', (port, url) => {
			console.log(port);
			console.log(url);
		});
		webContainer.mount(files);
	});

	function handleDrop(state: DragDropState<string>) {
		if (state.sourceContainer === state.targetContainer) {
			return;
		}

		updateFilesOnDrop(tempFiles, state);
		updateFilesOnDrop(files, state);
		setNodeInLocalStorage(node);
	}

	function updateFilesOnDrop(
		files: FileSystemTree,
		{ draggedItem, sourceContainer, targetContainer }: DragDropState<string>
	) {
		const sourceDirectoryPath =
			sourceContainer.split('/')[0] === '' ? [] : sourceContainer.split('/');
		const targetDirectoryPath =
			targetContainer.split('/')[0] === '' ? [] : targetContainer.split('/');
		const sourceItemDirectory = getDirectoryFromPath(files, sourceDirectoryPath);
		const targetItemDirectory = getDirectoryFromPath(files, targetDirectoryPath);

		const sourceItemPath = [...sourceDirectoryPath, draggedItem];
		if (
			sourceItemPath.length === selectedFilePath.length &&
			sourceItemPath.every((val, i) => val === selectedFilePath[i])
		) {
			selectedFilePath = [...targetDirectoryPath, draggedItem];
		}

		targetItemDirectory[draggedItem] = $state.snapshot(sourceItemDirectory[draggedItem]);
		delete sourceItemDirectory[draggedItem];
	}

	function getDirectoryFromPath(files: FileSystemTree, path: string[]) {
		return path.reduce((currentTree, item) => currentTree[item].directory, files);
	}
</script>

<svelte:head>
	<title>Editing {node?.data.name}</title>
</svelte:head>

{#if node}
	<div class="flex h-dvh w-screen">
		<div
			class="h-full w-1/7 bg-gray-950"
			use:droppable={{ container: '', callbacks: { onDrop: handleDrop } }}
		>
			<TreeView.Root>
				<FileTree bind:selectedFilePath currentPath={[]} {files} {handleDrop} />
			</TreeView.Root>
		</div>
		<div class="flex flex-1 flex-col">
			<div class="h-3/5">
				<TextArea {webContainer} {node} {selectedFilePath} {tempFiles} />
			</div>
			<div class="flex-1 bg-black">
				<Terminal {webContainer} />
			</div>
		</div>
	</div>
{:else}
	Node not found
{/if}
