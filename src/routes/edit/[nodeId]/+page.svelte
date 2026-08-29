<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';
	import Editor from './Editor.svelte';
	import InspectorSidebar from '$lib/components/InspectorSidebar.svelte';
	import Workspace from '$lib/components/Workspace.svelte';
	import { Spinner } from '$lib/components/ui/spinner';
	import { getGraphState, nodeConfig } from '$lib/graph-state.svelte';
	import { getResourceDefinition } from '$lib/resources';

	const { params }: PageProps = $props();

	const nodeId = untrack(() => params.nodeId);
	// Undefined when the id in the URL isn't a real node
	const node = getGraphState().getNode(nodeId);

	// Reachable by URL for any node, so resources whose files aren't editable are refused
	// here rather than only hidden in the inspector
	const definition = node ? getResourceDefinition(node.type) : undefined;
	// Only used for a node whose directory doesn't exist yet; mountNodeFiles leaves an
	// existing one alone
	const initialFiles = definition?.hasEditableFiles ? definition.files : undefined;
</script>

<svelte:head>
	<title>Editing {node && nodeConfig<{ name: string }>(node).name}</title>
</svelte:head>

<!-- The editor waits on the container; the inspector needs nothing from it, so it is
rendered either side of the boundary and stays in view for the whole wait -->
{#snippet rightSidebar()}
	<InspectorSidebar {nodeId} />
{/snippet}

<!-- Keeps the pane count stable across the boundary, so the saved layout doesn't thrash -->
{#snippet blank()}
	<div class="h-full"></div>
{/snippet}

{#if initialFiles}
	<svelte:boundary>
		<Editor {nodeId} {initialFiles} {rightSidebar} />

		{#snippet pending()}
			{#snippet mainContent()}
				<div class="flex h-full items-center justify-center gap-2 text-muted-foreground">
					<Spinner />
					Booting the container
				</div>
			{/snippet}

			<Workspace leftSidebar={blank} {mainContent} {rightSidebar} />
		{/snippet}

		{#snippet failed(error)}
			{#snippet mainContent()}
				<div
					class="flex h-full flex-col items-center justify-center gap-2 p-4 text-muted-foreground"
				>
					<p>Could not open this resource</p>
					<pre class="max-w-full overflow-x-auto text-xs">{error instanceof Error
							? error.message
							: String(error)}</pre>
				</div>
			{/snippet}

			<Workspace leftSidebar={blank} {mainContent} {rightSidebar} />
		{/snippet}
	</svelte:boundary>
{:else}
	<div class="flex h-dvh w-screen items-center justify-center text-muted-foreground">
		No files found for this resource
	</div>
{/if}
