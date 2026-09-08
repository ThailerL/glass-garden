<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';
	import Editor from './Editor.svelte';
	import InspectorSidebar from '$lib/components/InspectorSidebar.svelte';
	import Workspace from '$lib/components/Workspace.svelte';
	import { Spinner } from '$lib/components/ui/spinner';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { messageOf } from '$lib/errors';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getResourceDefinition } from '$lib/resources';
	import { nodeFiles } from '$lib/files/node-files';
	import { Button } from '$lib/components/ui/button';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import { resolve } from '$app/paths';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';

	const { params }: PageProps = $props();

	const orchestrator = getOrchestrator();

	const isMobile = new IsMobile();

	// Pinned open the panel would cover most of the file being edited, so on the small layout
	// it is something you ask for. Undefined rather than an empty snippet: Workspace reads the
	// absence, not the contents
	let infoOpen = $state(false);
	const inspector = $derived(!isMobile.current || infoOpen ? rightSidebar : undefined);
	const closeInspector = () => (infoOpen = false);

	const nodeId = untrack(() => params.nodeId);
	// Undefined when the id in the URL isn't a real node
	const node = getGraphState().getNode(nodeId);

	// Reachable by URL for any node, so resources whose files aren't editable are refused
	// here rather than only hidden in the inspector
	const definition = node ? getResourceDefinition(node.type) : undefined;
	// Only used for a node whose directory doesn't exist yet; mountNodeFiles leaves an
	// existing one alone
	const initialFiles = node && definition?.hasEditableFiles ? nodeFiles(node) : undefined;
</script>

<!-- The editor waits on the container; the inspector needs nothing from it, so it is
rendered either side of the boundary and stays in view for the whole wait -->
{#snippet rightSidebar()}
	<InspectorSidebar {nodeId} />
{/snippet}

<!-- Keeps the pane count stable across the boundary, so the saved layout doesn't thrash -->
{#snippet blank()}
	<div class="h-full"></div>
{/snippet}

<!-- Nothing to name while the container boots, so the bar carries only the way out -->
{#snippet bootBar()}
	<Button
		variant="ghost"
		size="icon"
		class="ml-auto"
		aria-label="Back to canvas"
		href={resolve('/')}
	>
		<ArrowLeftIcon />
	</Button>
{/snippet}

{#if initialFiles}
	<svelte:boundary>
		<Editor
			{nodeId}
			{initialFiles}
			rightSidebar={inspector}
			onDismissRightSidebar={closeInspector}
			onShowInfo={() => (infoOpen = !infoOpen)}
		/>

		{#snippet pending()}
			{#snippet mainContent()}
				<div class="flex h-full items-center justify-center gap-2 text-muted-foreground">
					<Spinner />
					{orchestrator.restoringDatabase ? 'Restoring database files' : 'Booting'}
				</div>
			{/snippet}

			<Workspace
				leftSidebar={blank}
				{mainContent}
				topBar={bootBar}
				rightSidebar={inspector}
				onDismissRightSidebar={closeInspector}
			/>
		{/snippet}

		{#snippet failed(error)}
			{#snippet mainContent()}
				<div
					class="flex h-full flex-col items-center justify-center gap-2 p-4 text-muted-foreground"
				>
					<p>Could not open this resource</p>
					<pre class="max-w-full overflow-x-auto text-xs">{messageOf(error)}</pre>
				</div>
			{/snippet}

			<Workspace
				leftSidebar={blank}
				{mainContent}
				topBar={bootBar}
				rightSidebar={inspector}
				onDismissRightSidebar={closeInspector}
			/>
		{/snippet}
	</svelte:boundary>
{:else}
	<div class="flex h-dvh w-screen items-center justify-center text-muted-foreground">
		No files found for this resource
	</div>
{/if}
