<script lang="ts">
	import CodeMirror from 'svelte-codemirror-editor';
	import { javascript } from '@codemirror/lang-javascript';
	import { WebContainer, type FileSystemTree } from '@webcontainer/api';
	import { getFileDraftState } from '$lib/file-draft-state.svelte';
	import { dracula } from '@uiw/codemirror-theme-dracula';
	import { mode } from 'mode-watcher';

	const {
		webContainer,
		selectedFilePath,
		files
	}: {
		webContainer: WebContainer;
		selectedFilePath: string[];
		files: FileSystemTree;
	} = $props();

	const fileDraftState = getFileDraftState();
	const currentDraft = $derived(
		fileDraftState.get(selectedFilePath) ?? getFileContents(files, selectedFilePath) ?? ''
	);
	const nothingSelected = $derived(selectedFilePath.length === 0);

	function onChange(value) {
		fileDraftState.set(selectedFilePath, value);
	}

	async function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			if (nothingSelected) return;
			await webContainer.fs.writeFile(selectedFilePath.join('/'), currentDraft);
			fileDraftState.markSaved(selectedFilePath);
		}
	}

	function getFileContents(tree: FileSystemTree, path: string[]): string | undefined {
		let node = tree[path[0]];
		for (let i = 1; i < path.length; i++) {
			if (!node || !Object.hasOwn(node, 'directory')) {
				return undefined;
			}
			node = node.directory[path[i]];
		}
		if (!node || !Object.hasOwn(node, 'file')) {
			return undefined;
		}
		return node.file.contents;
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<CodeMirror
	class="h-full"
	value={currentDraft}
	readonly={nothingSelected}
	placeholder={nothingSelected ? 'No file selected' : undefined}
	lang={javascript()}
	lineWrapping={true}
	onchange={onChange}
	// So that the unsaved icon displays right when typing starts
	nodebounce={true}
	theme={mode.current === 'dark' ? dracula : undefined}
	styles={{
		'&': {
			height: '100%',
			width: '100%'
		}
	}}
/>
