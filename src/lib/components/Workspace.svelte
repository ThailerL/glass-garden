<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Resizable from '$lib/components/ui/resizable';

	const {
		leftSidebar,
		mainContent,
		rightSidebar
	}: {
		leftSidebar: Snippet;
		mainContent: Snippet;
		rightSidebar?: Snippet;
	} = $props();
</script>

<!--
	Two nested groups rather than one flat row of three. paneforge keys a saved layout by the
	panes in the group, so one that gains and loses the inspector remembers a layout either way
	and snaps the left sidebar between them on every open, dragging the flow view sideways under
	the pointer. A group whose panes never change pins that edge, leaving the inspector to take
	its space from the right of the canvas.
-->
<Resizable.PaneGroup direction="horizontal" autoSaveId="workspace" class="h-dvh! w-screen!">
	<Resizable.Pane defaultSize={14} minSize={10} maxSize={40}>
		{@render leftSidebar()}
	</Resizable.Pane>

	<Resizable.Handle />

	<Resizable.Pane defaultSize={86}>
		<!-- Sizes here are of this group rather than the window, so they are the old
		window-relative ones over the 86 this group occupies -->
		<Resizable.PaneGroup direction="horizontal" autoSaveId="workspace-canvas">
			<Resizable.Pane defaultSize={77} minSize={35}>
				{@render mainContent()}
			</Resizable.Pane>

			{#if rightSidebar}
				<Resizable.Handle />

				<Resizable.Pane defaultSize={23} minSize={17} maxSize={47}>
					{@render rightSidebar()}
				</Resizable.Pane>
			{/if}
		</Resizable.PaneGroup>
	</Resizable.Pane>
</Resizable.PaneGroup>
