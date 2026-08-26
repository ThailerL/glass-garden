import { getContext, setContext } from 'svelte';
import { openDB, type IDBPDatabase } from 'idb';
import type { FileSystemTree } from '@webcontainer/api';
import { SvelteMap } from 'svelte/reactivity';

// Poor man's .gitignore
const EXCLUDED_FROM_PERSISTENCE = ['node_modules'];

export class FileState {
	files = $state(new SvelteMap<string, FileSystemTree>());
	#loading = new SvelteMap<string, Promise<FileSystemTree>>();
	#db: IDBPDatabase;
	// Other tabs write to the same IndexedDB, so our cache can go stale
	// when another tab saves. This channel tells other tabs when it saves
	// files so that the other tabs delete the stale data
	#channel = new BroadcastChannel('infralab:file-state');

	constructor(db: IDBPDatabase) {
		this.#db = db;
		this.#channel.onmessage = (event: MessageEvent<{ nodeId: string }>) => {
			this.files.delete(event.data.nodeId);
		};
	}

	async loadFiles(nodeId: string) {
		if (this.files.has(nodeId)) return this.files.get(nodeId);
		if (this.#loading.has(nodeId)) return this.#loading.get(nodeId);

		const promise = this.#db
			.get('files', nodeId)
			.then((fileTree) => {
				if (fileTree) {
					const reactiveFileTree = $state(fileTree);
					this.files.set(nodeId, reactiveFileTree);
				}
				return fileTree;
			})
			.finally(() => this.#loading.delete(nodeId));
		this.#loading.set(nodeId, promise);
		return promise;
	}

	async setFiles(nodeId: string, fileTree: FileSystemTree) {
		this.files.set(nodeId, fileTree);
		const persistedTree = Object.fromEntries(
			Object.entries($state.snapshot(fileTree)).filter(
				([name]) => !EXCLUDED_FROM_PERSISTENCE.includes(name)
			)
		);
		await this.#db.put('files', persistedTree, nodeId);
		this.#channel.postMessage({ nodeId });
	}

	async deleteFiles(nodeId: string) {
		this.files.delete(nodeId);
		await this.#db.delete('files', nodeId);
		this.#channel.postMessage({ nodeId });
	}
}

const FILE_KEY = Symbol('FILE');

export function setFileState(db: IDBPDatabase) {
	return setContext(FILE_KEY, new FileState(db));
}

export function getFileState() {
	return getContext<ReturnType<typeof setFileState>>(FILE_KEY);
}

export async function createFileDB() {
	return openDB('infralab', 1, {
		upgrade(db) {
			db.createObjectStore('files');
		}
	});
}
