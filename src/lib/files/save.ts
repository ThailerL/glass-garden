import type { Vivari } from '@vivari/core';
import { requestPersistentStorage } from '../container';
import type { FileDraftState } from './draft-state.svelte';
import type { FileRefresh } from './refresh.svelte';

// Shared by the editor's save key and the button the small layout puts in its bar, which has
// no keyboard to press the first with
export async function saveFile(
	container: Vivari,
	root: string,
	path: string[],
	drafts: FileDraftState,
	refresh: FileRefresh
) {
	const baseline = drafts.getBaseline(path);
	// Nothing is open, so there is nothing to write
	if (baseline === undefined) return;

	const contents = drafts.getDraft(path) ?? baseline;
	await container.fs.writeFile([root, ...path].join('/'), contents);
	// Not awaited: on Firefox this prompts, and saving shouldn't wait on an answer
	void requestPersistentStorage();
	// The file holds the draft now, so the marker clears without reading it back
	drafts.setBaseline(path, contents);
	refresh.bump();
}
