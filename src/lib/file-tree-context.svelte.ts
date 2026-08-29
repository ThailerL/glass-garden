import { getContext, setContext } from 'svelte';
import type { Vivari } from '@vivari/core';
import type { DragDropState } from '@thisux/sveltednd';

const FILE_TREE_KEY = Symbol('FILE_TREE');

export class FileTreeContext {
	renamingPath = $state<string | undefined>();

	constructor(
		readonly container: Vivari,
		readonly root: string,
		readonly onDrop: (state: DragDropState<string>) => void
	) {}

	get anyItemBeingRenamed() {
		return this.renamingPath !== undefined;
	}

	fsPath(path: string[]) {
		return [this.root, ...path].join('/');
	}
}

export function setFileTreeContext(
	container: Vivari,
	root: string,
	onDrop: (state: DragDropState<string>) => void
) {
	return setContext(FILE_TREE_KEY, new FileTreeContext(container, root, onDrop));
}

export function getFileTreeContext() {
	return getContext<ReturnType<typeof setFileTreeContext>>(FILE_TREE_KEY);
}
