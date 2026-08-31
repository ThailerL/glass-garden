import type { Vivari } from '@vivari/core';
import type { DragDropState } from '@thisux/sveltednd';
import { createContext } from './context';
import { createFile, createFolder } from './file-tree.svelte';
import type { FileRefresh } from './file-refresh.svelte';

export class FileTreeContext {
	renamingPath = $state<string | undefined>();

	constructor(
		readonly container: Vivari,
		readonly root: string,
		readonly refresh: FileRefresh,
		readonly onDrop: (state: DragDropState<string>) => void
	) {}

	get anyItemBeingRenamed() {
		return this.renamingPath !== undefined;
	}

	fsPath(path: string[]) {
		return [this.root, ...path].join('/');
	}

	async createFile(directory: string[], siblingNames: string[]) {
		await createFile(this.container, siblingNames, this.fsPath(directory));
		this.refresh.bump();
	}

	async createFolder(directory: string[], siblingNames: string[]) {
		await createFolder(this.container, siblingNames, this.fsPath(directory));
		this.refresh.bump();
	}
}

const fileTreeContext = createContext<FileTreeContext>('FILE_TREE');

export function setFileTreeContext(
	container: Vivari,
	root: string,
	refresh: FileRefresh,
	onDrop: (state: DragDropState<string>) => void
) {
	return fileTreeContext.set(new FileTreeContext(container, root, refresh, onDrop));
}

export const getFileTreeContext = fileTreeContext.get;
