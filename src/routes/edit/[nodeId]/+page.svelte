<script lang="ts">
	import { WebContainer } from '@webcontainer/api';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import { page } from '$app/state';
	import * as TreeView from '$lib/components/ui/tree-view';
	import Terminal from '$lib/components/Terminal.svelte';
	import FileTree, { getItemNamesInOrder } from './FileTree.svelte';
	import TextArea from './TextArea.svelte';
	import { getFileState } from '$lib/file-state.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { setFileDraftState } from '$lib/file-draft-state.svelte';

	setFileDraftState();

	const nodeId = page.params.nodeId;
	const nodeName = getGraphState().getNode(nodeId)?.data.name;
	const fileState = getFileState();
	let files = $state(await fileState.loadFiles(nodeId));
	let selectedFilePath = $state<string[]>([]);
	let anyItemBeingRenamed = $state(false);

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
			files = structuredClone(await webContainer.export(''));
			fileState.setFiles(nodeId, files);
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

		webContainer.fs.rename(
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
	<title>Editing {nodeName}</title>
</svelte:head>

<div class="flex h-dvh w-screen">
	<div class="h-full w-1/7" use:droppable={{ container: '', callbacks: { onDrop: handleDrop } }}>
		<TreeView.Root>
			{#each getItemNamesInOrder(files) as itemName (itemName)}
				<FileTree
					bind:selectedFilePath
					bind:anyItemBeingRenamed
					item={Object.hasOwn(files[itemName], 'directory')
						? files[itemName].directory
						: files[itemName].file}
					{itemName}
					itemType={Object.hasOwn(files[itemName], 'directory') ? 'directory' : 'file'}
					parentDirectory={files}
					parentPath={[]}
					{webContainer}
					{handleDrop}
				/>
			{/each}
		</TreeView.Root>
	</div>
	<div class="flex w-full flex-col">
		<div class="min-h-0 flex-3/5">
			<TextArea {webContainer} {selectedFilePath} {files} />
		</div>
		<div class="flex-1">
			<Terminal {webContainer} />
		</div>
	</div>
</div>
