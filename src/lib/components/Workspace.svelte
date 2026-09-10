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
	import { IsCompact } from '$lib/hooks/is-compact.svelte';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import XIcon from '@lucide/svelte/icons/x';

	const {
		leftSidebar,
		mainContent,
		topBar,
		rightSidebar,
		onDismissRightSidebar
	}: {
		// Takes its own dismiss: adding a resource closes the sheet it was tapped in
		leftSidebar: Snippet<[() => void]>;
		mainContent: Snippet;
		// A route that wants a bar gets the sheet trigger inside it; one that doesn't gets the
		// trigger floating over its content. Ignored on the wide layout, which has neither
		topBar?: Snippet;
		rightSidebar?: Snippet;
		// What closing the panel dismisses is a selection this component does not own
		onDismissRightSidebar?: () => void;
	} = $props();

	// A compact surface gives up its sidebar; only a phone also stacks the inspector
	const isCompact = new IsCompact();
	const isMobile = new IsMobile();
	// Of a row with no sidebar in it, so the wide layout's 23 would be narrower in pixels
	const inspectorShare = $derived(isCompact.current ? 35 : 23);

	let menuOpen = $state(false);
</script>

{#snippet menuButton(extra?: string)}
	<Button
		variant={topBar ? 'ghost' : 'outline'}
		size="icon"
		class={extra}
		aria-label="Open menu"
		onclick={() => (menuOpen = true)}
	>
		<MenuIcon />
	</Button>
{/snippet}

{#snippet bar()}
	<div class="flex h-12 shrink-0 items-center gap-0.5 border-b bg-background pr-1.5 pl-1">
		{@render menuButton()}
		{@render topBar!()}
	</div>
{/snippet}

{#snippet canvasPanes()}
	<Resizable.PaneGroup direction="horizontal" autoSaveId="workspace-canvas">
		<Resizable.Pane defaultSize={100 - inspectorShare} minSize={35}>
			{@render mainContent()}
		</Resizable.Pane>

		{#if rightSidebar}
			<Resizable.Handle />

			<Resizable.Pane defaultSize={inspectorShare} minSize={17} maxSize={47}>
				{@render rightSidebar()}
			</Resizable.Pane>
		{/if}
	</Resizable.PaneGroup>
{/snippet}

{#if isCompact.current}
	<div class="flex h-dvh w-screen flex-col">
		{#if topBar}{@render bar()}{/if}
		<div class="min-h-0 flex-1">
			{#if isMobile.current}
				{@render mainContent()}
			{:else}
				{@render canvasPanes()}
			{/if}
		</div>
	</div>

	{#if !topBar}
		{@render menuButton('fixed top-3 left-3 z-50 shadow-sm')}
	{/if}

	<!-- A panel, not a sheet: a sheet is modal, and its overlay would swallow taps on the canvas -->
	{#if isMobile.current && rightSidebar}
		<div
			data-mobile-panel
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

	<Sheet.Root bind:open={menuOpen}>
		<Sheet.Content side="left" class="w-56 gap-0 p-0 sm:max-w-56" showCloseButton={false}>
			<Sheet.Header class="sr-only">
				<Sheet.Title>Menu</Sheet.Title>
			</Sheet.Header>
			{@render leftSidebar(() => (menuOpen = false))}
		</Sheet.Content>
	</Sheet.Root>
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

		<!-- Sizes inside are of this pane, so they are the window-relative ones over the 86 -->
		<Resizable.Pane defaultSize={86}>
			{@render canvasPanes()}
		</Resizable.Pane>
	</Resizable.PaneGroup>
{/if}
