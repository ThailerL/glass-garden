import { getContext, setContext } from 'svelte';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FileSystemTree } from '@vivari/core';

// Poor man's .gitignore
export const EXCLUDED_FROM_PERSISTENCE = ['node_modules'];

export function withoutExcludedFiles(tree: FileSystemTree): FileSystemTree {
	const result: FileSystemTree = {};
	for (const [name, node] of Object.entries(tree)) {
		if (EXCLUDED_FROM_PERSISTENCE.includes(name)) continue;
		result[name] = 'directory' in node ? { directory: withoutExcludedFiles(node.directory) } : node;
	}
	return result;
}

interface FileDB extends DBSchema {
	files: {
		key: string;
		value: FileSystemTree;
	};
}

export type FileDatabase = IDBPDatabase<FileDB>;

export class FileStore {
	// Nothing renders from this map, so it doesn't need to be a SvelteMap
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	files = new Map<string, FileSystemTree>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#loading = new Map<string, Promise<FileSystemTree | undefined>>();
	#db: FileDatabase;

	constructor(db: FileDatabase) {
		this.#db = db;
	}

	async loadFiles(nodeId: string) {
		if (this.files.has(nodeId)) return this.files.get(nodeId);
		if (this.#loading.has(nodeId)) return this.#loading.get(nodeId);

		const promise = this.#db
			.get('files', nodeId)
			.then((fileTree) => {
				if (fileTree) this.files.set(nodeId, fileTree);
				return fileTree;
			})
			.finally(() => this.#loading.delete(nodeId));
		this.#loading.set(nodeId, promise);
		return promise;
	}

	async setFiles(nodeId: string, fileTree: FileSystemTree) {
		this.files.set(nodeId, fileTree);
		await this.#db.put('files', withoutExcludedFiles($state.snapshot(fileTree)), nodeId);
	}

	async deleteFiles(nodeId: string) {
		this.files.delete(nodeId);
		await this.#db.delete('files', nodeId);
	}
}

const FILE_KEY = Symbol('FILE');

export function setFileStore(db: FileDatabase) {
	return setContext(FILE_KEY, new FileStore(db));
}

export function getFileStore() {
	return getContext<ReturnType<typeof setFileStore>>(FILE_KEY);
}

export async function createFileDB(): Promise<FileDatabase> {
	return openDB<FileDB>('glass-garden', 1, {
		upgrade(db) {
			db.createObjectStore('files');
		}
	});
}
