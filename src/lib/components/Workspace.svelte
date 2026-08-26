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

<Resizable.PaneGroup direction="horizontal" autoSaveId="workspace" class="h-dvh! w-screen!">
	<Resizable.Pane defaultSize={14} minSize={10} maxSize={40}>
		{@render leftSidebar()}
	</Resizable.Pane>

	<Resizable.Handle />

	<Resizable.Pane defaultSize={66} minSize={30}>
		{@render mainContent()}
	</Resizable.Pane>

	{#if rightSidebar}
		<Resizable.Handle />

		<Resizable.Pane defaultSize={20} minSize={15} maxSize={40}>
			{@render rightSidebar()}
		</Resizable.Pane>
	{/if}
</Resizable.PaneGroup>
