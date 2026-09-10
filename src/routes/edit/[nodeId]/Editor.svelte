<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import type { FileSystemTree } from '@vivari/core';
	import { getContainer, mountNodeFiles, nodeDirectory } from '$lib/container';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import ShellDock from '$lib/components/ShellDock.svelte';
	import Workspace from '$lib/components/Workspace.svelte';
	import RootFileTree from './RootFileTree.svelte';
	import TextEditor from './TextEditor.svelte';
	import { setFileDraftState, setFileRefresh, saveFile } from '$lib/files';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { shellLaunchOptions } from '$lib/shell-launch';
	import { shellSessions, type ShellOwner } from '$lib/shell-sessions.svelte';
	import { IsCompact } from '$lib/hooks/is-compact.svelte';
	import { Button } from '$lib/components/ui/button';
	import { resolve } from '$app/paths';
	import InfoIcon from '@lucide/svelte/icons/info';
	import SaveIcon from '@lucide/svelte/icons/save';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';

	// Nothing inside the container announces what it writes, so the open listings re-read on
	// a timer to catch the terminal, npm install, and running processes
	const POLL_INTERVAL_MS = 300;

	// rightSidebar is rendered by the parent, which keeps it mounted while these panes
	// are still waiting on the container
	const {
		nodeId,
		initialFiles,
		rightSidebar,
		onDismissRightSidebar,
		onShowInfo
	}: {
		nodeId: string;
		initialFiles: FileSystemTree;
		rightSidebar?: Snippet;
		onDismissRightSidebar?: () => void;
		onShowInfo?: () => void;
	} = $props();

	const isCompact = new IsCompact();

	// The node id keys the mount; rootPath is the same node addressed as an absolute path
	// inside the container, which is what the fs and the shell want
	const root = untrack(() => nodeId);
	const rootPath = nodeDirectory(root);

	let selectedFilePath = $state<string[]>([]);

	const fileDraftState = setFileDraftState(root);
	const refresh = setFileRefresh();

	const container = await getContainer();
	// Each node owns a directory named after it, so the orchestrator and the editor can
	// share one container without stepping on each other
	await mountNodeFiles(
		root,
		untrack(() => initialFiles)
	);

	const save = () => saveFile(container, rootPath, selectedFilePath, fileDraftState, refresh);

	const poll = setInterval(() => refresh.bump(), POLL_INTERVAL_MS);

	$effect(() => () => clearInterval(poll));

	// A shell for this node is here on arrival, as it was before tabs; the canvas opens none.
	// The compact layout gets none either, for the reason it has no terminal
	const shellOwner: ShellOwner = { kind: 'node', nodeId: root };
	const orchestrator = getOrchestrator();
	if (!isCompact.current) {
		shellSessions.ensureFor(shellOwner, () => shellLaunchOptions(shellOwner, orchestrator));
	}
</script>

{#snippet leftSidebar(dismiss: () => void)}
	<Sidebar.Root collapsible="none" class="w-full!">
		<Sidebar.Content class="p-2">
			<!-- On the small layout the tree is a sheet over the file it opens, so picking one
			puts it away -->
			<RootFileTree bind:selectedFilePath root={rootPath} {container} onSelect={dismiss} />
		</Sidebar.Content>
	</Sidebar.Root>
{/snippet}

<!-- The name sits in the bar Workspace builds, so it is not repeated over the file. Save is
here because the key that does it on a desktop needs a keyboard -->
{#snippet topBar()}
	<div class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
		{selectedFilePath.join('/')}
	</div>
	<Button
		variant="ghost"
		size="icon"
		aria-label="Save file"
		disabled={!fileDraftState.isDirty(selectedFilePath)}
		onclick={save}
	>
		<SaveIcon />
	</Button>
	<Button variant="ghost" size="icon" aria-label="Resource details" onclick={onShowInfo}>
		<InfoIcon />
	</Button>
	<Button variant="ghost" size="icon" aria-label="Back to canvas" href={resolve('/')}>
		<ArrowLeftIcon />
	</Button>
{/snippet}

{#snippet editor()}
	<div class="flex h-full flex-col">
		{#if !isCompact.current}
			<div class="truncate text-sm text-muted-foreground">{selectedFilePath.join('/')}</div>
		{/if}
		<div class="min-h-0 flex-1">
			<TextEditor {container} root={rootPath} {selectedFilePath} {save} />
		</div>
	</div>
{/snippet}

{#snippet mainContent()}
	{#if isCompact.current}
		{@render editor()}
	{:else}
		<ShellDock owner={shellOwner} main={editor} />
	{/if}
{/snippet}

<Workspace {leftSidebar} {mainContent} {topBar} {rightSidebar} {onDismissRightSidebar} />
