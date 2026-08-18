<script lang="ts">
	import { WebContainer, type FileSystemTree } from '@webcontainer/api';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import { page } from '$app/state';
	import * as TreeView from '$lib/components/ui/tree-view';
	import { getNodeFromLocalStorage, setNodeInLocalStorage } from '$lib/utils';
	import Terminal from '$lib/components/Terminal.svelte';
	import FileTree from './FileTree.svelte';
	import TextArea from './TextArea.svelte';

	const node = getNodeFromLocalStorage(page.params.nodeId);
	let files = $state(node?.data.files as FileSystemTree);
	let selectedFilePath = $state<string[]>([]);

	const webContainer = await WebContainer.boot({ workdirName: 'infralab' });
	webContainer.on('server-ready', (port, url) => {
		console.log(port);
		console.log(url);
	});
	webContainer.mount(files);
	// When files are updated in the WebContainers FS it will sync the changes to the app
	// So to manage files only need to call the WebContainer API
	webContainer.fs.watch(
		'',
		{ recursive: true },
		// This is the easy way: just export the whole filesystem no matter what the change was
		async () => {
			files = structuredClone(await webContainer?.export(''));
			node.data.files = files;
			setNodeInLocalStorage(node);
		}
	);

	function handleDrop({ draggedItem, sourceContainer, targetContainer }: DragDropState<string>) {
		// directories can't be dragged into itself or a child directory of itself
		if (
			sourceContainer === targetContainer ||
			targetContainer.startsWith(
				sourceContainer === '' ? draggedItem : [sourceContainer, draggedItem].join('/')
			)
		) {
			return;
		}

		webContainer?.fs.rename(
			[sourceContainer, draggedItem].join('/'),
			[targetContainer, draggedItem].join('/')
		);

		const sourcePath = sourceContainer === '' ? [] : sourceContainer.split('/');
		const targetPath = targetContainer === '' ? [] : targetContainer.split('/');
		if (selectedFilePath.join('/') === [...sourcePath, draggedItem].join('/')) {
			selectedFilePath = [...targetPath, draggedItem];
		}
	}
</script>

<svelte:head>
	<title>Editing {node?.data.name}</title>
</svelte:head>

{#if node?.data.files}
	<div class="flex h-dvh w-screen">
		<div class="h-full w-1/7" use:droppable={{ container: '', callbacks: { onDrop: handleDrop } }}>
			<TreeView.Root>
				<FileTree bind:selectedFilePath currentPath={[]} {files} {webContainer} {handleDrop} />
			</TreeView.Root>
		</div>
		<div class="flex flex-1 flex-col">
			<div class="h-3/5">
				<TextArea {webContainer} {selectedFilePath} />
			</div>
			<div class="flex-1">
				<Terminal {webContainer} />
			</div>
		</div>
	</div>
{:else if node}
	Node has no editable code
{:else}
	Node does not exist
{/if}
