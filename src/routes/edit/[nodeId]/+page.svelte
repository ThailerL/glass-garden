<script lang="ts">
	import { WebContainer } from '@webcontainer/api';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import { page } from '$app/state';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as Resizable from '$lib/components/ui/resizable/index.js';
	import Terminal from '$lib/components/Terminal.svelte';
	import FileTree, { getItemNamesInOrder } from './FileTree.svelte';
	import TextEditor from './TextEditor.svelte';
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
	let terminal: ReturnType<typeof Terminal>;

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

<Resizable.PaneGroup
	direction="horizontal"
	class="h-dvh! w-screen!"
	autoSaveId="code-editor-layout-0"
>
	<Resizable.Pane defaultSize={14} minSize={10} maxSize={40}>
		<div use:droppable={{ container: '', callbacks: { onDrop: handleDrop } }}>
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
	</Resizable.Pane>

	<Resizable.Handle />

	<Resizable.Pane defaultSize={86}>
		<Resizable.PaneGroup direction="vertical" autoSaveId="code-editor-layout-1">
			<Resizable.Pane defaultSize={60} minSize={20}>
				<TextEditor {webContainer} {selectedFilePath} {files} />
			</Resizable.Pane>

			<Resizable.Handle />

			<Resizable.Pane defaultSize={40} minSize={10}>
				<Terminal {webContainer} />
			</Resizable.Pane>
		</Resizable.PaneGroup>
	</Resizable.Pane>
</Resizable.PaneGroup>
