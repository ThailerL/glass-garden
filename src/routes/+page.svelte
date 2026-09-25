<script lang="ts">
	import { page } from '$app/state';
	import { appView } from '$lib/app-view';
	import CanvasView from './canvas/CanvasView.svelte';
	import Catalogue from './catalogue/Catalogue.svelte';
	import { loadEditor } from '$lib/load-editor';

	const view = $derived(appView(page.url));
</script>

{#if view.name === 'edit'}
	{#key view.nodeId}
		{#await loadEditor() then { default: EditorView }}
			<EditorView nodeId={view.nodeId} />
		{/await}
	{/key}
{:else if view.name === 'challenges'}
	<Catalogue />
{:else}
	<CanvasView />
{/if}
