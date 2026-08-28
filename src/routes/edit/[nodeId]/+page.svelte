<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';
	import Editor from './Editor.svelte';
	import { getFileStore } from '$lib/file-store.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getResourceDefinition } from '$lib/resources';

	const { params }: PageProps = $props();

	const nodeId = untrack(() => params.nodeId);
	// Undefined when the id in the URL isn't a real node
	const node = getGraphState().getNode(nodeId);

	// Falls back to the original snapshot for a node that has never been started or edited
	const initialFiles = node
		? ((await getFileStore().loadFiles(nodeId)) ?? getResourceDefinition(node.type).snapshot)
		: undefined;
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
