import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { EditorState } from '@codemirror/state';
import { isAtOrUnder } from './file-tree.svelte';

function moveKeys<T>(map: SvelteMap<string, T>, from: string, to: string) {
	for (const [key, value] of [...map]) {
		if (!isAtOrUnder(key, from)) continue;
		map.delete(key);
		map.set(to + key.slice(from.length), value);
	}
}

function deleteKeys<T>(map: SvelteMap<string, T>, path: string) {
	for (const key of [...map.keys()]) {
		if (isAtOrUnder(key, path)) map.delete(key);
	}
}

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

	movePath(from: string[], to: string[]) {
		moveKeys(this.editorStates, from.join('/'), to.join('/'));
		moveKeys(this.#baselines, from.join('/'), to.join('/'));
	}

	discardPath(path: string[]) {
		deleteKeys(this.editorStates, path.join('/'));
		deleteKeys(this.#baselines, path.join('/'));
	}

	isDirty(path: string[]) {
		const draft = this.getDraft(path);
		return draft !== undefined && draft !== (this.getBaseline(path) ?? '');
	}

	containsDirty(path: string[]) {
		const prefix = path.join('/');
		return [...this.editorStates.keys()].some(
			(key) => isAtOrUnder(key, prefix) && this.isDirty(key.split('/'))
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
