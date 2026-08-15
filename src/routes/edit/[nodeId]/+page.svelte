<script lang="ts">
	import CodeMirror from 'svelte-codemirror-editor';
	import { javascript } from '@codemirror/lang-javascript';
	import { page } from '$app/state';
	import { getNodeFromLocalStorage } from '$lib/utils';

	let value = '';
	const node = getNodeFromLocalStorage(page.params.nodeId);
</script>

<svelte:head>
	<title>Editing {node?.data.name}</title>
</svelte:head>
<CodeMirror bind:value lang={javascript()} />
