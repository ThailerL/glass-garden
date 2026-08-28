import type { Vivari, FileSystemTree, DirectoryNode, FileNode } from '@vivari/core';
import { EXCLUDED_FROM_PERSISTENCE } from './file-store.svelte';

function unusedName(directory: FileSystemTree, base: string): string {
	let i = 1;
	while (Object.hasOwn(directory, `${base}-${i}`)) {
		i++;
	}
	return `${base}-${i}`;
}

export function createFile(container: Vivari, directory: FileSystemTree, directoryFsPath: string) {
	return container.fs.writeFile([directoryFsPath, unusedName(directory, 'new-file')].join('/'), '');
}

export function createFolder(
	container: Vivari,
	directory: FileSystemTree,
	directoryFsPath: string
) {
	return container.fs.mkdir([directoryFsPath, unusedName(directory, 'new-folder')].join('/'));
}

export function getItemNamesInOrder(directory: FileSystemTree): string[] {
	const directoryNames = Object.keys(directory)
		.filter((itemName) => Object.hasOwn(directory[itemName], 'directory'))
		.sort();
	const fileNames = Object.keys(directory)
		.filter((itemName) => Object.hasOwn(directory[itemName], 'file'))
		.sort();

	return [...directoryNames, ...fileNames];
}

export function getFileContents(tree: FileSystemTree, path: string[]): string | undefined {
	let node: DirectoryNode | FileNode | undefined = tree[path[0]];
	for (let i = 1; i < path.length; i++) {
		if (!node || !('directory' in node)) {
			return undefined;
		}
		node = node.directory[path[i]];
	}
	if (
		!node ||
		!('file' in node) ||
		!('contents' in node.file) ||
		typeof node.file.contents !== 'string'
	) {
		return undefined;
	}
	return node.file.contents;
}

// Vivari has no export(), so the tree is walked by hand. Excluded directories are skipped
// during the walk rather than filtered out afterwards, which keeps a node_modules-sized
// directory from being read into memory only to be thrown away
export async function exportTree(container: Vivari, root: string): Promise<FileSystemTree> {
	const entries = await container.fs.readdir(root, { withFileTypes: true });
	const nodes = await Promise.all(
		entries
			.filter((entry) => !EXCLUDED_FROM_PERSISTENCE.includes(entry.name))
			.map(async (entry): Promise<[string, DirectoryNode | FileNode] | undefined> => {
				const entryPath = [root, entry.name].join('/');
				if (entry.isDirectory()) {
					return [entry.name, { directory: await exportTree(container, entryPath) }];
				}
				if (entry.isFile()) {
					return [
						entry.name,
						{ file: { contents: await container.fs.readFile(entryPath, 'utf-8') } }
					];
				}
			})
	);
	return Object.fromEntries(nodes.filter((node) => node !== undefined));
}
