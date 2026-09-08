<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import * as Resizable from '$lib/components/ui/resizable';
	import ShellTabs from './ShellTabs.svelte';
	import ShellViews from './ShellViews.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { shellLaunchOptions } from '$lib/shell-launch';
	import { shellSessions, type ShellOwner } from '$lib/shell-sessions.svelte';

	// One component for both routes: paneforge keys a saved layout by the group id and every
	// pane's constraints, so sharing the markup is what keeps the layout shared
	const { owner, main }: { owner: ShellOwner; main: Snippet } = $props();

	const orchestrator = getOrchestrator();

	let pane = $state<ReturnType<typeof Resizable.Pane>>();

	// Shut until there is something to show; the editor always has a shell and no way to
	// reopen a shut pane, so an inherited collapse is undone there
	$effect(() => {
		if (!pane) return;
		// Untracked whole: the pane methods read paneforge's own layout state, and tracking it
		// would re-run this on every drag or expand
		untrack(() => {
			if (shellSessions.shells.length === 0) pane?.collapse();
			else if (owner.kind === 'node' && pane?.isCollapsed()) pane.resize(40);
		});
	});

	export function toggle() {
		if (!pane?.isCollapsed()) return pane?.collapse();
		// Opening an empty pane would show only a strip and a plus button, so it arrives with
		// the shell this place would have made anyway
		if (shellSessions.shells.length === 0) {
			shellSessions.open(owner, shellLaunchOptions(owner, orchestrator));
		}
		pane.expand();
	}
</script>

<Resizable.PaneGroup direction="vertical" autoSaveId="workspace-shell">
	<Resizable.Pane defaultSize={100} minSize={20}>
		{@render main()}
	</Resizable.Pane>

	<Resizable.Handle />

	<Resizable.Pane bind:this={pane} collapsible collapsedSize={0} defaultSize={0} minSize={15}>
		<div class="flex h-full flex-col">
			<ShellTabs {owner} onOpen={() => pane?.expand()} />
			<div class="min-h-0 flex-1">
				<ShellViews />
			</div>
		</div>
	</Resizable.Pane>
</Resizable.PaneGroup>
