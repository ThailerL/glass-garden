<script lang="ts" module>
	// How much of a phone's canvas the inspector covers; the canvas lifts nodes clear of it
	export const PANEL_FRACTION = 0.6;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Resizable from '$lib/components/ui/resizable';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import XIcon from '@lucide/svelte/icons/x';

	const {
		leftSidebar,
		mainContent,
		rightSidebar,
		onDismissRightSidebar
	}: {
		// Takes its own dismiss: adding a resource closes the sheet it was tapped in
		leftSidebar: Snippet<[() => void]>;
		mainContent: Snippet;
		rightSidebar?: Snippet;
		// What closing the panel dismisses is a selection this component does not own
		onDismissRightSidebar?: () => void;
	} = $props();

	const isMobile = new IsMobile();

	let menuOpen = $state(false);
</script>

{#if isMobile.current}
	<div class="h-dvh w-screen">
		{@render mainContent()}
	</div>

	<Button
		variant="outline"
		size="icon"
		class="fixed top-3 left-3 z-50 shadow-sm"
		aria-label="Open menu"
		onclick={() => (menuOpen = true)}
	>
		<MenuIcon />
	</Button>

	<Sheet.Root bind:open={menuOpen}>
		<Sheet.Content side="left" class="w-72 gap-0 p-0 sm:max-w-72">
			<Sheet.Header class="sr-only">
				<Sheet.Title>Menu</Sheet.Title>
			</Sheet.Header>
			{@render leftSidebar(() => (menuOpen = false))}
		</Sheet.Content>
	</Sheet.Root>

	<!-- A panel, not a sheet: a sheet is modal, and its overlay would swallow taps on the canvas -->
	{#if rightSidebar}
		<div
			class="fixed inset-x-0 bottom-0 z-40 animate-in overflow-hidden rounded-t-xl border-t
			       bg-sidebar shadow-lg duration-200 slide-in-from-bottom"
			style="height: {PANEL_FRACTION * 100}dvh"
		>
			<Button
				variant="ghost"
				size="icon-sm"
				class="absolute top-3 right-3 z-10"
				aria-label="Close panel"
				onclick={onDismissRightSidebar}
			>
				<XIcon />
			</Button>
			{@render rightSidebar()}
		</div>
	{/if}
{:else}
	<!--
		Two nested groups rather than one flat row of three. paneforge keys a saved layout by the
		panes in the group, so one that gains and loses the inspector remembers a layout either way
		and snaps the left sidebar between them on every open, dragging the flow view sideways under
		the pointer. A group whose panes never change pins that edge, leaving the inspector to take
		its space from the right of the canvas.
	-->
	<Resizable.PaneGroup direction="horizontal" autoSaveId="workspace" class="h-dvh! w-screen!">
		<Resizable.Pane defaultSize={14} minSize={10} maxSize={40}>
			{@render leftSidebar(() => {})}
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
{/if}
