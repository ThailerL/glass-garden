<script lang="ts">
	import { untrack } from 'svelte';
	import type { FileSystemTree } from '@vivari/core';
	import { getContainer, mountNodeFiles, nodeDirectory } from '$lib/container';
	import * as Resizable from '$lib/components/ui/resizable';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import Terminal from '$lib/components/Terminal.svelte';
	import InspectorSidebar from '$lib/components/InspectorSidebar.svelte';
	import Workspace from '$lib/components/Workspace.svelte';
	import RootFileTree from './RootFileTree.svelte';
	import TextEditor from './TextEditor.svelte';
	import { getFileStore } from '$lib/file-store.svelte';
	import { setFileDraftState } from '$lib/file-draft-state.svelte';
	import { setFileRefresh } from '$lib/file-refresh';
	import { exportTree } from '$lib/file-tree';

	// Editor-driven writes refresh almost immediately; the poll is the backstop for writes
	// made inside the container by the terminal, by npm install, or by a running process
	const REFRESH_DEBOUNCE_MS = 100;
	const POLL_INTERVAL_MS = 1000;

	const { nodeId, initialFiles }: { nodeId: string; initialFiles: FileSystemTree } = $props();

	const fileStore = getFileStore();

	// The node id keys persistence and the mount; rootPath is the same node addressed as an
	// absolute path inside the container, which is what the fs and the shell want
	const root = untrack(() => nodeId);
	const rootPath = nodeDirectory(root);

	let files = $state<FileSystemTree>({});
	let selectedFilePath = $state<string[]>([]);
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;

	async function readFiles() {
		files = await exportTree(container, rootPath);
		fileStore.setFiles(root, files);
	}

	function scheduleRefresh() {
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(readFiles, REFRESH_DEBOUNCE_MS);
	}

	setFileDraftState(() => files);
	// Both contexts are registered before the first await so they land during component
	// init; the container scheduleRefresh needs is assigned just below
	setFileRefresh(scheduleRefresh);

	const container = await getContainer();
	// Each node owns a directory named after it, so the orchestrator and the editor can
	// share one container without stepping on each other
	await mountNodeFiles(
		root,
		untrack(() => initialFiles)
	);
	// Read back rather than trusting initialFiles, because a running node may have
	// changed the directory since it was persisted
	files = await exportTree(container, rootPath);

	const poll = setInterval(readFiles, POLL_INTERVAL_MS);

	$effect(() => () => {
		clearTimeout(refreshTimer);
		clearInterval(poll);
	});
</script>

{#snippet leftSidebar()}
	<Sidebar.Root collapsible="none" class="w-full!">
		<Sidebar.Content class="p-2">
			<RootFileTree bind:selectedFilePath {files} root={rootPath} {container} />
		</Sidebar.Content>
	</Sidebar.Root>
{/snippet}

{#snippet mainContent()}
	<Resizable.PaneGroup direction="vertical" autoSaveId="editor-main">
		<Resizable.Pane defaultSize={60} minSize={20}>
			<div class="flex h-full flex-col">
				<div class="truncate text-sm text-muted-foreground">{selectedFilePath.join('/')}</div>
				<div class="min-h-0 flex-1">
					<TextEditor {container} root={rootPath} {selectedFilePath} {files} />
				</div>
			</div>
		</Resizable.Pane>

		<Resizable.Handle />

		<Resizable.Pane defaultSize={40} minSize={10}>
			<Terminal {container} cwd={rootPath} />
		</Resizable.Pane>
	</Resizable.PaneGroup>
{/snippet}

{#snippet rightSidebar()}
	<InspectorSidebar nodeId={root} />
{/snippet}

<Workspace {leftSidebar} {mainContent} {rightSidebar} />
