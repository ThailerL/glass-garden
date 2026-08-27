import type {
	WebContainer,
	FileSystemTree,
	DirectoryNode,
	FileNode,
	SymlinkNode
} from '@webcontainer/api';

function unusedName(directory: FileSystemTree, base: string): string {
	let i = 1;
	while (Object.hasOwn(directory, `${base}-${i}`)) {
		i++;
	}
	return `${base}-${i}`;
}

export function createFile(
	webContainer: WebContainer,
	directory: FileSystemTree,
	directoryFsPath: string
) {
	return webContainer.fs.writeFile(
		[directoryFsPath, unusedName(directory, 'new-file')].join('/'),
		''
	);
}

export function createFolder(
	webContainer: WebContainer,
	directory: FileSystemTree,
	directoryFsPath: string
) {
	return webContainer.fs.mkdir([directoryFsPath, unusedName(directory, 'new-folder')].join('/'));
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
