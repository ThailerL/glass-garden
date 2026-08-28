import { getContext, setContext } from 'svelte';

const FILE_REFRESH_KEY = Symbol('FILE_REFRESH');

// The editor owns a node's file tree, but the mutations are triggered from the components
// below it. Vivari has no fs.watch, so instead of a watcher noticing the write, those
// components ask the editor to re-read the directory
export function setFileRefresh(refresh: () => void) {
	return setContext(FILE_REFRESH_KEY, refresh);
}

export function getFileRefresh() {
	return getContext<() => void>(FILE_REFRESH_KEY);
}
