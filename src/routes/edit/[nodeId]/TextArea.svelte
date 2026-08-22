<script lang="ts">
	import CodeMirror from 'svelte-codemirror-editor';
	import { javascript } from '@codemirror/lang-javascript';
	import { WebContainer } from '@webcontainer/api';

	const {
		webContainer,
		selectedFilePath
	}: {
		webContainer: WebContainer;
		selectedFilePath: string[];
	} = $props();

	const value = $derived(await webContainer.fs.readFile(selectedFilePath.join('/'), 'utf-8'));

	function onChange(value) {
		webContainer.fs.writeFile(selectedFilePath.join('/'), value);
	}
</script>

{#if selectedFilePath.length === 0}
	<CodeMirror value="" placeholder="No file selected" readonly={true} />
{:else}
	<CodeMirror {value} lang={javascript()} lineWrapping={true} onchange={onChange} />
{/if}
