import type { FileSystemTree } from '@vivari/core';

// Code extensions only, since a page or a stylesheet is not what the editor was opened for
const ENTRY = /^(server|index|main)\.(js|mjs|cjs|ts|py)$/;

// Level by level, so a root server.js wins over anything nested
export function fileToOpen(files: FileSystemTree): string[] {
	let level = [{ path: [] as string[], tree: files }];
	while (level.length > 0) {
		for (const { path, tree } of level) {
			const name = Object.keys(tree).find((key) => ENTRY.test(key));
			if (name) return [...path, name];
		}
		const next: typeof level = [];
		for (const { path, tree } of level)
			for (const [name, entry] of Object.entries(tree))
				if ('directory' in entry) next.push({ path: [...path, name], tree: entry.directory });
		level = next;
	}
	return [];
}

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
