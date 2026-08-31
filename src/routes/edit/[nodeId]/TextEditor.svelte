<script lang="ts">
	import CodeMirror from 'svelte-codemirror-editor';
	import { javascript } from '@codemirror/lang-javascript';
	import { html } from '@codemirror/lang-html';
	import { css } from '@codemirror/lang-css';
	import { json } from '@codemirror/lang-json';
	import type { EditorView } from '@codemirror/view';
	import { Vivari } from '@vivari/core';
	import { getFileDraftState } from '$lib/file-draft-state.svelte';
	import { dracula } from '@uiw/codemirror-theme-dracula';
	import { mode } from 'mode-watcher';
	import { getFileRefresh } from '$lib/file-refresh.svelte';
	import { requestPersistentStorage } from '$lib/container';

	const {
		container,
		root,
		selectedFilePath
	}: {
		container: Vivari;
		root: string;
		selectedFilePath: string[];
	} = $props();

	const fileDraftState = getFileDraftState();
	const refresh = getFileRefresh();

	// An extension with nothing here is left unhighlighted, which reads better than
	// highlighting it as something it isn't
	const languages = { js: javascript, mjs: javascript, cjs: javascript, json, html, css };

	const nothingSelected = $derived(selectedFilePath.length === 0);
	const extension = $derived(selectedFilePath.at(-1)?.match(/\.(\w+)$/)?.[1]);
	const language = $derived(languages[extension as keyof typeof languages]?.());
	const currentDraft = $derived(
		fileDraftState.getDraft(selectedFilePath) ?? fileDraftState.getBaseline(selectedFilePath) ?? ''
	);

	let view: EditorView | undefined = $state();

	$effect(() => {
		if (nothingSelected) return;
		// Captured so a read that lands after the selection moves still writes its own key
		const path = selectedFilePath;
		container.fs
			.readFile([root, ...path].join('/'), 'utf-8')
			// An unreadable file reads as empty rather than keeping a stale baseline
			.catch(() => '')
			.then((contents) => fileDraftState.setBaseline(path, contents));
	});

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
			const saved = currentDraft;
			await container.fs.writeFile([root, ...selectedFilePath].join('/'), saved);
			// Not awaited: on Firefox this prompts, and saving shouldn't wait on an answer
			void requestPersistentStorage();
			// The file holds the draft now, so the marker clears without reading it back
			fileDraftState.setBaseline(selectedFilePath, saved);
			refresh.bump();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<CodeMirror
	class="h-full"
	value={currentDraft}
	readonly={nothingSelected}
	placeholder={nothingSelected ? 'No file selected' : undefined}
	lang={language}
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
