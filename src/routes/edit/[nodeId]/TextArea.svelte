<script lang="ts">
	import CodeMirror from 'svelte-codemirror-editor';
	import { javascript } from '@codemirror/lang-javascript';
	import { EditorView } from '@codemirror/view';
	import type { Node } from '@xyflow/svelte';
	import { setNodeInLocalStorage } from '$lib/utils';
	import { WebContainer, type FileSystemTree } from '@webcontainer/api';

	const {
		webContainer,
		node,
		selectedFilePath,
		tempFiles
	}: {
		webContainer: WebContainer | undefined;
		node: Node;
		selectedFilePath: string[];
		tempFiles: FileSystemTree;
	} = $props();

	const openedFile = $derived(getFileForPath(tempFiles as FileSystemTree, selectedFilePath));

	const value = $derived(openedFile.contents);

	const keybindings = [
		{
			key: 'Mod-s',
			preventDefault: true,
			run: (view: EditorView) => {
				getFileForPath(node.data.files as FileSystemTree, selectedFilePath).contents =
					view.state.doc.toString();
				if (webContainer) {
					webContainer.mount(node.data.files as FileSystemTree);
				}
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

<CodeMirror
	{value}
	lang={javascript()}
	placeholder="No file selected"
	lineWrapping={true}
	{keybindings}
	onchange={(value) => (openedFile.contents = value)}
/>
