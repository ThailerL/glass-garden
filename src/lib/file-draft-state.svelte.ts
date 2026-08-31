import { SvelteMap } from 'svelte/reactivity';
import type { EditorState } from '@codemirror/state';
import { createContext } from './context';
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
	// What each opened file holds on disk
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

	// Anything unsaved anywhere, for the guard that has no one path to ask about
	get anyDirty() {
		return [...this.editorStates.keys()].some((key) => this.isDirty(key.split('/')));
	}

	containsDirty(path: string[]) {
		const prefix = path.join('/');
		return [...this.editorStates.keys()].some(
			(key) => isAtOrUnder(key, prefix) && this.isDirty(key.split('/'))
		);
	}
}

const fileDraftContext = createContext<FileDraftState>('FILE_DRAFT');

// Outlives the editor, so leaving for the canvas and coming back keeps what was typed. One
// per node, because the paths a state is keyed by are relative to its node
const states = new SvelteMap<string, FileDraftState>();

export function setFileDraftState(nodeId: string) {
	let state = states.get(nodeId);
	if (!state) {
		state = new FileDraftState();
		states.set(nodeId, state);
	}
	return fileDraftContext.set(state);
}

// Across every node, so a guard outside the editor still knows about work left unsaved in
// one that is not open
export function anyDraftsDirty() {
	return [...states.values()].some((state) => state.anyDirty);
}

export const getFileDraftState = fileDraftContext.get;
