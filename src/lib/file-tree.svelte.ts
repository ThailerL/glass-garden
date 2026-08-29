import type { Vivari, DirEnt } from '@vivari/core';
import { getFileRefresh } from './file-refresh.svelte';

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
// each alphabetical
async function listDirectory(container: Vivari, path: string): Promise<DirEnt[]> {
	const entries = await container.fs.readdir(path, { withFileTypes: true });
	return entries.sort((a, b) =>
		a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1
	);
}

// One directory's entries, re-read whenever anything writes to the container. Call during
// component init: it reads the refresh context and owns an effect. `isOpen` lets a closed
// folder skip the read entirely, which is what keeps the tree from walking the whole node
export function directoryListing(container: Vivari, path: string, isOpen = () => true) {
	const refresh = getFileRefresh();

	let entries = $state<DirEnt[]>([]);
	// The revision the listing was read at, so a slow read can't land on top of a newer one
	let listedRevision = -1;

	$effect(() => {
		if (!isOpen()) return;
		const revision = refresh.revision;
		listDirectory(container, path).then((result) => {
			if (revision < listedRevision) return;
			listedRevision = revision;
			entries = result;
		});
	});

	// Derived rather than mapped per access: every child reads it to check for name
	// collisions, so a getter would walk the directory once per entry
	const names = $derived(entries.map((entry) => entry.name));

	return {
		get entries() {
			return entries;
		},
		get names() {
			return names;
		}
	};
}
