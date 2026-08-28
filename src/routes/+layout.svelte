<script lang="ts">
	import { untrack } from 'svelte';
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import favicon from '$lib/assets/favicon.svg';
	import { setGraphState } from '$lib/graph-state.svelte';
	import { setFileStore } from '$lib/file-store.svelte';
	import { setOrchestrator } from '$lib/orchestrator.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	const fileStore = setFileStore(untrack(() => data.db));
	const graphState = setGraphState(fileStore);
	// Set here rather than on the canvas so the editor route shares one orchestrator,
	// and with it one container and one set of running instances
	setOrchestrator(graphState, fileStore);
</script>

<Toaster position="bottom-center" toastOptions={{ duration: 2000 }} />
<ModeWatcher />

<Sidebar.Provider>
	{@render children?.()}
</Sidebar.Provider>
<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Glass Garden</title>
</svelte:head>
