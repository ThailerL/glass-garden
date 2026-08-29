<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import { ConfirmDeleteDialog } from '$lib/components/ui/confirm-delete-dialog';
	import favicon from '$lib/assets/favicon.svg';
	import { setGraphState } from '$lib/graph-state.svelte';
	import { setOrchestrator } from '$lib/orchestrator.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const graphState = setGraphState();
	// Set here rather than on the canvas so the editor route shares one orchestrator,
	// and with it one container and one set of running instances
	const orchestrator = setOrchestrator(graphState);

	orchestrator.warmUp();
</script>

<Toaster position="bottom-center" toastOptions={{ duration: 2000 }} />
<!-- One instance for the whole app; confirmDelete() drives it from anywhere -->
<ConfirmDeleteDialog />
<ModeWatcher />

<Sidebar.Provider>
	{@render children?.()}
</Sidebar.Provider>
<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Glass Garden</title>
</svelte:head>
