<script lang="ts">
	import { untrack } from 'svelte';
	import type { FileSystemTree } from '@webcontainer/api';
	import { getWebContainer, mountNodeFiles } from '$lib/webcontainer';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import * as TreeView from '$lib/components/ui/tree-view';
	import * as Resizable from '$lib/components/ui/resizable';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import Terminal from '$lib/components/Terminal.svelte';
	import InspectorSidebar from '$lib/components/InspectorSidebar.svelte';
	import Workspace from '$lib/components/Workspace.svelte';
	import { getItemNamesInOrder } from '$lib/file-tree';
	import FileTree from './FileTree.svelte';
	import TextEditor from './TextEditor.svelte';
	import { getFileStore, withoutExcludedFiles } from '$lib/file-store.svelte';
	import { setFileDraftState } from '$lib/file-draft-state.svelte';

	const WATCH_DEBOUNCE_MS = 100;

	const { nodeId, initialFiles }: { nodeId: string; initialFiles: FileSystemTree } = $props();

	setFileDraftState(() => files);

	const fileStore = getFileStore();

	const root = untrack(() => nodeId);

	let files = $state(untrack(() => initialFiles));
	let selectedFilePath = $state<string[]>([]);
	let anyItemBeingRenamed = $state(false);

	const webContainer = await getWebContainer();
	// Each node owns a directory named after it, so the orchestrator and the editor can
	// share one container without stepping on each other
	await mountNodeFiles(
		root,
		untrack(() => initialFiles)
	);
	// Read back rather than trusting initialFiles, because a running node may have
	// changed the directory since it was persisted
	files = withoutExcludedFiles(structuredClone(await webContainer.export(root)));

	let watchTimer: ReturnType<typeof setTimeout> | undefined;
	// When files are updated in the WebContainers FS it will sync the changes to the app
	// So to manage files only need to call the WebContainer API
	const watcher = webContainer.fs.watch(root, { recursive: true }, () => {
		clearTimeout(watchTimer);
		// This is the easy way: just export the whole directory no matter what the change was
		watchTimer = setTimeout(async () => {
			files = withoutExcludedFiles(structuredClone(await webContainer.export(root)));
			fileStore.setFiles(root, files);
		}, WATCH_DEBOUNCE_MS);
	});

	$effect(() => () => {
		clearTimeout(watchTimer);
		watcher.close();
	});

	function handleDrop({ draggedItem, sourceContainer, targetContainer }: DragDropState<string>) {
		// directories can't be dragged into itself or a child directory of itself
		if (
			targetContainer === null ||
			sourceContainer === targetContainer ||
			targetContainer.startsWith(
				sourceContainer === '' ? draggedItem : [sourceContainer, draggedItem].join('/')
			)
		) {
			return;
		}

		webContainer.fs.rename(
			[root, sourceContainer, draggedItem].filter(Boolean).join('/'),
			[root, targetContainer, draggedItem].filter(Boolean).join('/')
		);

		const sourcePath = sourceContainer === '' ? [] : sourceContainer.split('/');
		const targetPath = targetContainer === '' ? [] : targetContainer.split('/');
		if (selectedFilePath.join('/') === [...sourcePath, draggedItem].join('/')) {
			selectedFilePath = [...targetPath, draggedItem];
		}
	}
</script>

{#snippet leftSidebar()}
	<Sidebar.Root collapsible="none" class="w-full!">
		<Sidebar.Content class="p-2">
			<div class="min-h-full" use:droppable={{ container: '', callbacks: { onDrop: handleDrop } }}>
				<TreeView.Root>
					{#each getItemNamesInOrder(files) as itemName (itemName)}
						<FileTree
							bind:selectedFilePath
							bind:anyItemBeingRenamed
							item={'directory' in files[itemName]
								? files[itemName].directory
								: files[itemName].file}
							{itemName}
							itemType={'directory' in files[itemName] ? 'directory' : 'file'}
							parentDirectory={files}
							parentPath={[]}
							{root}
							{webContainer}
							{handleDrop}
						/>
					{/each}
				</TreeView.Root>
			</div>
		</Sidebar.Content>
	</Sidebar.Root>
{/snippet}

{#snippet mainContent()}
	<Resizable.PaneGroup direction="vertical" autoSaveId="editor-main">
		<Resizable.Pane defaultSize={60} minSize={20}>
			<div class="flex h-full flex-col">
				<div class="truncate text-sm text-muted-foreground">{selectedFilePath.join('/')}</div>
				<div class="min-h-0 flex-1">
					<TextEditor {webContainer} {root} {selectedFilePath} {files} />
				</div>
			</div>
		</Resizable.Pane>

		<Resizable.Handle />

		<Resizable.Pane defaultSize={40} minSize={10}>
			<Terminal {webContainer} cwd={root} />
		</Resizable.Pane>
	</Resizable.PaneGroup>
{/snippet}

{#snippet rightSidebar()}
	<InspectorSidebar nodeId={root} />
{/snippet}

<Workspace {leftSidebar} {mainContent} {rightSidebar} />
