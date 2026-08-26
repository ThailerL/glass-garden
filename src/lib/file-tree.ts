import type { FileSystemTree, DirectoryNode, FileNode, SymlinkNode } from '@webcontainer/api';

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
	let node: DirectoryNode | FileNode | SymlinkNode | undefined = tree[path[0]];
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
