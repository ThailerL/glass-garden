<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';
	import Editor from './Editor.svelte';
	import { getFileStore } from '$lib/file-store.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';

	const { params }: PageProps = $props();

	const nodeId = untrack(() => params.nodeId);
	const nodeName = getGraphState().getNode(nodeId)?.data.name;

	// Undefined when the node has no stored files, i.e. the id in the URL isn't a real node
	const files = await getFileStore().loadFiles(nodeId);
</script>

<svelte:head>
	<title>Editing {nodeName}</title>
</svelte:head>

{#if files}
	<Editor {nodeId} initialFiles={files} />
{:else}
	<div class="flex h-dvh w-screen items-center justify-center text-muted-foreground">
		No files found for this resource
	</div>
{/if}
