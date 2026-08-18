<script lang="ts">
	import CodeMirror from 'svelte-codemirror-editor';
	import { javascript } from '@codemirror/lang-javascript';
	import { WebContainer, type FileSystemTree } from '@webcontainer/api';

	const {
		webContainer,
		files,
		selectedFilePath
	}: {
		webContainer: WebContainer;
		files: FileSystemTree;
		selectedFilePath: string[];
	} = $props();

	const openedFile = $derived(getFileForPath(selectedFilePath));

	const value = $derived(openedFile.contents);

	function getFileForPath(path: string[]): { contents: string } {
		return path.reduce((currentFile, itemName, index) => {
			if (index === selectedFilePath.length - 1) {
				return currentFile[itemName].file;
			} else {
				return currentFile[itemName].directory;
			}
		}, files);
	}

	function onChange(value) {
		webContainer.fs.writeFile(selectedFilePath.join('/'), value);
	}
</script>

{#if selectedFilePath.length === 0}
	<CodeMirror value="" placeholder="No file selected" readonly={true} />
{:else}
	<CodeMirror {value} lang={javascript()} lineWrapping={true} onchange={onChange} />
{/if}
