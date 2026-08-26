<script lang="ts">
	import { untrack } from 'svelte';
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import favicon from '$lib/assets/favicon.svg';
	import { setGraphState } from '$lib/graph-state.svelte';
	import { setFileState } from '$lib/file-state.svelte';
	import { setOrchestrator } from '$lib/orchestrator.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	const fileState = setFileState(untrack(() => data.db));
	const graphState = setGraphState(fileState);
	// Set here rather than on the canvas so the editor route shares one orchestrator,
	// and with it one WebContainer and one set of running instances
	setOrchestrator(graphState, fileState);
</script>

<Toaster />
<ModeWatcher />

<Sidebar.Provider>
	{@render children?.()}
</Sidebar.Provider>
<svelte:head>
	<link rel="icon" href={favicon} />
	<title>InfraLab</title>
</svelte:head>
