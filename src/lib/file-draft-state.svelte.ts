import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { EditorState } from '@codemirror/state';
import type { FileSystemTree } from '@vivari/core';
import { getFileContents } from './file-tree';

export class FileDraftState {
	editorStates = new SvelteMap<string, EditorState>();

	constructor(private getFiles: () => FileSystemTree) {}

	getDraft(path: string[]) {
		return this.editorStates.get(path.join('/'))?.doc.toString();
	}

	getEditorState(path: string[]) {
		return this.editorStates.get(path.join('/'));
	}

	setEditorState(path: string[], state: EditorState) {
		this.editorStates.set(path.join('/'), state);
	}

	isDirty(path: string[]) {
		const draft = this.getDraft(path);
		return draft !== undefined && draft !== (getFileContents(this.getFiles(), path) ?? '');
	}

	containsDirty(path: string[]) {
		const prefix = path.join('/');
		return [...this.editorStates.keys()].some(
			(key) => key.startsWith(prefix) && this.isDirty(key.split('/'))
		);
	}
}

const FILE_DRAFT_KEY = Symbol('FILE_DRAFT');

export function setFileDraftState(getFiles: () => FileSystemTree) {
	return setContext(FILE_DRAFT_KEY, new FileDraftState(getFiles));
}

export function getFileDraftState() {
	return getContext<ReturnType<typeof setFileDraftState>>(FILE_DRAFT_KEY);
}
