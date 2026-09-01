<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import type { FileSystemTree } from '@vivari/core';
	import { getContainer, mountNodeFiles, nodeDirectory } from '$lib/container';
	import * as Resizable from '$lib/components/ui/resizable';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import Terminal from '$lib/components/Terminal.svelte';
	import Workspace from '$lib/components/Workspace.svelte';
	import RootFileTree from './RootFileTree.svelte';
	import TextEditor from './TextEditor.svelte';
	import { setFileDraftState, setFileRefresh } from '$lib/files';

	// Nothing inside the container announces what it writes, so the open listings re-read on
	// a timer to catch the terminal, npm install, and running processes
	const POLL_INTERVAL_MS = 300;

	// rightSidebar is rendered by the parent, which keeps it mounted while these panes
	// are still waiting on the container
	const {
		nodeId,
		initialFiles,
		rightSidebar
	}: { nodeId: string; initialFiles: FileSystemTree; rightSidebar: Snippet } = $props();

	// The node id keys the mount; rootPath is the same node addressed as an absolute path
	// inside the container, which is what the fs and the shell want
	const root = untrack(() => nodeId);
	const rootPath = nodeDirectory(root);

	let selectedFilePath = $state<string[]>([]);

	setFileDraftState(root);
	const refresh = setFileRefresh();

	const container = await getContainer();
	// Each node owns a directory named after it, so the orchestrator and the editor can
	// share one container without stepping on each other
	await mountNodeFiles(
		root,
		untrack(() => initialFiles)
	);

	const poll = setInterval(() => refresh.bump(), POLL_INTERVAL_MS);

	$effect(() => () => clearInterval(poll));
</script>

{#snippet leftSidebar()}
	<Sidebar.Root collapsible="none" class="w-full!">
		<Sidebar.Content class="p-2">
			<RootFileTree bind:selectedFilePath root={rootPath} {container} />
		</Sidebar.Content>
	</Sidebar.Root>
{/snippet}

{#snippet mainContent()}
	<Resizable.PaneGroup direction="vertical" autoSaveId="editor-main">
		<Resizable.Pane defaultSize={60} minSize={20}>
			<div class="flex h-full flex-col">
				<div class="truncate text-sm text-muted-foreground">{selectedFilePath.join('/')}</div>
				<div class="min-h-0 flex-1">
					<TextEditor {container} root={rootPath} {selectedFilePath} />
				</div>
			</div>
		</Resizable.Pane>

		<Resizable.Handle />

		<Resizable.Pane defaultSize={40} minSize={10}>
			<Terminal {container} cwd={rootPath} />
		</Resizable.Pane>
	</Resizable.PaneGroup>
{/snippet}

<Workspace {leftSidebar} {mainContent} {rightSidebar} />
