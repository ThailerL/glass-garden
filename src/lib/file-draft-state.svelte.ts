import { getContext, setContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

export class FileDraftState {
	drafts = new SvelteMap<string, string>();
	dirty = new SvelteSet<string>();

	get(path: string[]) {
		return this.drafts.get(path.join('/'));
	}

	set(path: string[], value: string) {
		this.dirty.add(path.join('/'));
		this.drafts.set(path.join('/'), value);
	}

	markSaved(path: string[]) {
		this.dirty.delete(path.join('/'));
	}

	isDirty(path: string[]) {
		return this.dirty.has(path.join('/'));
	}
}

const FILE_DRAFT_KEY = Symbol('FILE_DRAFT');

export function setFileDraftState() {
	return setContext(FILE_DRAFT_KEY, new FileDraftState());
}

export function getFileDraftState() {
	return getContext<ReturnType<typeof setFileDraftState>>(FILE_DRAFT_KEY);
}
