<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';
	import Editor from './Editor.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
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
	<title>Editing {node?.data.name}</title>
</svelte:head>

{#if initialFiles}
	<Editor {nodeId} {initialFiles} />
{:else}
	<div class="flex h-dvh w-screen items-center justify-center text-muted-foreground">
		No files found for this resource
	</div>
{/if}
