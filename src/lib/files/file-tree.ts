import type { FileSystemTree } from '@vivari/core';

export function fileTree(files: Record<string, string | Uint8Array>): FileSystemTree {
	const tree: FileSystemTree = {};
	for (const [path, contents] of Object.entries(files)) {
		const names = path.split('/');
		const name = names.pop()!;
		let directory = tree;
		for (const segment of names) {
			const entry = (directory[segment] ??= { directory: {} });
			if (!('directory' in entry)) throw new Error(`${path} is under a file`);
			directory = entry.directory;
		}
		directory[name] = { file: { contents } };
	}
	return tree;
}
