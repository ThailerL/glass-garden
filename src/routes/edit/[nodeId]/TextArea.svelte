<script lang="ts">
	import CodeMirror from 'svelte-codemirror-editor';
	import { javascript } from '@codemirror/lang-javascript';
	import { EditorView } from '@codemirror/view';
	import type { Node } from '@xyflow/svelte';
	import { setNodeInLocalStorage } from '$lib/utils';
	import { type FileSystemTree } from '@webcontainer/api';

	const { node, selectedFilePath }: { node: Node; selectedFilePath: string[] } = $props();

	// svelte-ignore state_referenced_locally
	const tempFiles = structuredClone(node.data.files);

	const openedFile = $derived(getFileForPath(tempFiles as FileSystemTree, selectedFilePath));

	const value = $derived(openedFile.contents);

	const keybindings = [
		{
			key: 'Mod-s',
			preventDefault: true,
			run: (view: EditorView) => {
				getFileForPath(node.data.files, selectedFilePath).contents = view.state.doc.toString();
				setNodeInLocalStorage(node);
				return true;
			}
		}
	];

	function getFileForPath(files: FileSystemTree, path: string[]): { contents: string } {
		return path.reduce((currentFile, itemName, index) => {
			if (index === selectedFilePath.length - 1) {
				return currentFile[itemName].file;
			} else {
				return currentFile[itemName].directory;
			}
		}, files);
	}
</script>

{#if selectedFilePath.length === 0}
	No file selected
{:else}
	<CodeMirror
		{value}
		lang={javascript()}
		{keybindings}
		onchange={(value) => (openedFile.contents = value)}
	/>
{/if}
