<script lang="ts">
	import { untrack } from 'svelte';
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import { ConfirmDeleteDialog } from '$lib/components/ui/confirm-delete-dialog';
	import favicon from '$lib/assets/favicon.svg';
	import { setGraphState } from '$lib/graph-state.svelte';
	import { anyDraftsDirty } from '$lib/file-draft-state.svelte';
	import { setOrchestrator } from '$lib/orchestrator.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	// Switching projects is a full page load, so this is read once rather than tracked
	const graphState = setGraphState(untrack(() => data.projectId));
	// Set here rather than on the canvas so the editor route shares one orchestrator,
	// and with it one container and one set of running instances
	const orchestrator = setOrchestrator(graphState);

	orchestrator.warmUp();

	// Drafts outlive the editor, so this is asked here rather than there: unsaved work in a
	// node the user has since navigated away from is still unsaved. The browser writes the
	// wording itself, and cancelling the event is the whole message
	function warnAboutUnsaved(event: BeforeUnloadEvent) {
		if (!anyDraftsDirty()) return;
		event.preventDefault();
		// Firefox takes the hint from returnValue rather than the cancellation
		event.returnValue = true;
	}
</script>

<svelte:window onbeforeunload={warnAboutUnsaved} />

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
