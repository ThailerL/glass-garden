<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { ConfirmDeleteDialog } from '$lib/components/ui/confirm-delete-dialog';
	import ResourceNameDialog from '$lib/components/ResourceNameDialog.svelte';
	import { setGraphState } from '$lib/graph-state.svelte';
	import { embedded, whenInView } from '$lib/embed';
	import { anyDraftsDirty } from '$lib/files';
	import { offerSharedProject } from '$lib/share-link-offer';
	import { tour } from '$lib/tour.svelte';
	import { setOrchestrator } from '$lib/orchestrator.svelte';
	import { onContainerBoot } from '$lib/container';
	import { installAwsCli } from '$lib/aws-cli';
	import * as Sidebar from '$lib/components/ui/sidebar';

	const {
		projectId,
		start = false,
		children
	}: { projectId: string; start?: boolean; children?: Snippet } = $props();

	// Switching projects is a full page load, so this is read once rather than tracked
	const graphState = setGraphState(untrack(() => projectId));
	// Set here rather than on the canvas so the editor route shares one orchestrator,
	// and with it one container and one set of running instances
	const orchestrator = setOrchestrator(graphState);

	onContainerBoot(installAwsCli);
	orchestrator.warmUp();
	if (untrack(() => start)) whenInView(() => orchestrator.startAll());
	void offerSharedProject();
	// The tour's last card points at the Projects sidebar, which an embed hides
	if (embedded) tour.hold();

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

<!-- A link pasted into an open tab's address bar only changes the hash -->
<svelte:window onbeforeunload={warnAboutUnsaved} onhashchange={offerSharedProject} />

<Toaster position="bottom-center" toastOptions={{ duration: 2000 }} />
<!-- One instance for the whole app; confirmDelete() drives it from anywhere -->
<ConfirmDeleteDialog />
<ResourceNameDialog />

<Sidebar.Provider>
	{@render children?.()}
</Sidebar.Provider>
