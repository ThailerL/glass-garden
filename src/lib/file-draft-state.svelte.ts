import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { EditorState } from '@codemirror/state';

export class FileDraftState {
	editorStates = new SvelteMap<string, EditorState>();
	// What each opened file holds on disk. Kept here so a draft can be told apart from a
	// saved file without the whole directory in memory
	#baselines = new SvelteMap<string, string>();

	getDraft(path: string[]) {
		return this.editorStates.get(path.join('/'))?.doc.toString();
	}

	getEditorState(path: string[]) {
		return this.editorStates.get(path.join('/'));
	}

	setEditorState(path: string[], state: EditorState) {
		this.editorStates.set(path.join('/'), state);
	}

	getBaseline(path: string[]) {
		return this.#baselines.get(path.join('/'));
	}

	setBaseline(path: string[], contents: string) {
		this.#baselines.set(path.join('/'), contents);
	}

	isDirty(path: string[]) {
		const draft = this.getDraft(path);
		return draft !== undefined && draft !== (this.getBaseline(path) ?? '');
	}

	containsDirty(path: string[]) {
		const prefix = path.join('/');
		return [...this.editorStates.keys()].some(
			(key) => key.startsWith(prefix) && this.isDirty(key.split('/'))
		);
	}
}

const FILE_DRAFT_KEY = Symbol('FILE_DRAFT');

export function setFileDraftState() {
	return setContext(FILE_DRAFT_KEY, new FileDraftState());
}

export function getFileDraftState() {
	return getContext<ReturnType<typeof setFileDraftState>>(FILE_DRAFT_KEY);
}
