import type { Vivari, DirEnt } from '@vivari/core';

function unusedName(names: string[], base: string): string {
	let i = 1;
	while (names.includes(`${base}-${i}`)) {
		i++;
	}
	return `${base}-${i}`;
}

export function createFile(container: Vivari, names: string[], directoryFsPath: string) {
	return container.fs.writeFile([directoryFsPath, unusedName(names, 'new-file')].join('/'), '');
}

export function createFolder(container: Vivari, names: string[], directoryFsPath: string) {
	return container.fs.mkdir([directoryFsPath, unusedName(names, 'new-folder')].join('/'));
}

// One directory's entries in the order the tree draws them: directories first, then files,
// each alphabetical. Read per directory as it opens, so nothing walks the whole node
export async function listDirectory(container: Vivari, path: string): Promise<DirEnt[]> {
	const entries = await container.fs.readdir(path, { withFileTypes: true });
	return entries.sort((a, b) =>
		a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1
	);
}
