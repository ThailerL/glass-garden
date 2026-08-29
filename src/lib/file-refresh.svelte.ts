import { getContext, setContext } from 'svelte';

const FILE_REFRESH_KEY = Symbol('FILE_REFRESH');

// Each directory in the editor reads its own listing, but Vivari has no fs.watch and a drag
// moves a file between two directories at once. Everything that writes to the container
// bumps this instead, and every listing on screen re-reads itself
export class FileRefresh {
	revision = $state(0);

	bump() {
		this.revision++;
	}
}

export function setFileRefresh() {
	return setContext(FILE_REFRESH_KEY, new FileRefresh());
}

export function getFileRefresh() {
	return getContext<ReturnType<typeof setFileRefresh>>(FILE_REFRESH_KEY);
}
