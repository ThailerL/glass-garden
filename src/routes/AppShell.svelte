<script lang="ts">
	import { onDestroy, untrack, type Snippet } from 'svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { ConfirmDeleteDialog } from '$lib/components/ui/confirm-delete-dialog';
	import ResourceNameDialog from '$lib/components/ResourceNameDialog.svelte';
	import { setGraphState } from '$lib/graph-state.svelte';
	import { embedded, hostGoals, tellHost, whenInView } from '$lib/embed';
	import { anyDraftsDirty } from '$lib/files';
	import { offerSharedProject } from '$lib/share-link-offer';
	import { tour } from '$lib/tour.svelte';
	import { setOrchestrator } from '$lib/orchestrator.svelte';
	import { getProject } from '$lib/projects.svelte';
	import { ChallengeRun, setChallengeRun } from '$lib/challenge-run.svelte';
	import { runServices } from '$lib/challenge-services';
	import { onContainerBoot } from '$lib/container';
	import { installAwsCli } from '$lib/aws-cli';
	import * as Sidebar from '$lib/components/ui/sidebar';

	const {
		projectId,
		start = false,
		children
	}: { projectId: string; start?: boolean; children?: Snippet } = $props();

	// Switching projects is a full page load, so this is read once rather than tracked
	const id = untrack(() => projectId);
	const graphState = setGraphState(id);
	// Set here rather than on the canvas so the editor route shares one orchestrator,
	// and with it one container and one set of running instances
	const orchestrator = setOrchestrator(graphState);

	onContainerBoot(installAwsCli);
	orchestrator.warmUp();
	if (untrack(() => start)) whenInView(() => orchestrator.startAll());
	void offerSharedProject();
	// The tour's last card points at the Projects sidebar, which an embed hides
	if (embedded) tour.hold();
	// A challenge names its nodes, so it runs this canvas as it stands
	const project = getProject(id);
	const challenge = project?.challenge;
	const run = setChallengeRun(
		challenge
			? new ChallengeRun(challenge, runServices(id, challenge, graphState, orchestrator))
			: undefined
	);
	orchestrator.whileRunning(() => run?.active ?? false);
	onDestroy(() => run?.dispose());
	// Sent on load as well as after a run, so an embedding page keeps no score of its own
	if (challenge) {
		tellHost({ event: 'best', met: project?.bestRun ?? [], goals: hostGoals(challenge) });
	}

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
