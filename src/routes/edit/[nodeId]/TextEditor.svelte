<script lang="ts">
	import CodeMirror from 'svelte-codemirror-editor';
	import { javascript } from '@codemirror/lang-javascript';
	import type { EditorView } from '@codemirror/view';
	import { Vivari, type FileSystemTree } from '@vivari/core';
	import { getFileDraftState } from '$lib/file-draft-state.svelte';
	import { getFileContents } from '$lib/file-tree';
	import { dracula } from '@uiw/codemirror-theme-dracula';
	import { mode } from 'mode-watcher';
	import { getFileRefresh } from '$lib/file-refresh';

	const {
		container,
		root,
		selectedFilePath,
		files
	}: {
		container: Vivari;
		root: string;
		selectedFilePath: string[];
		files: FileSystemTree;
	} = $props();

	const fileDraftState = getFileDraftState();
	const currentDraft = $derived(
		fileDraftState.getDraft(selectedFilePath) ?? getFileContents(files, selectedFilePath) ?? ''
	);
	const nothingSelected = $derived(selectedFilePath.length === 0);

	let view: EditorView | undefined = $state();

	const refreshFiles = getFileRefresh();

	function onChange() {
		if (view) fileDraftState.setEditorState(selectedFilePath, view.state);
	}

	function onReady(editorView: EditorView) {
		view = editorView;
	}

	$effect(() => {
		if (!view) return;
		const cached = fileDraftState.getEditorState(selectedFilePath);
		if (cached) view.setState(cached);
	});

	async function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			if (nothingSelected) return;
			await container.fs.writeFile([root, ...selectedFilePath].join('/'), currentDraft);
			refreshFiles();
		}
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
	onready={onReady}
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
