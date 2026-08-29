import { Vivari, type FileSystemTree } from '@vivari/core';

// Only one container is booted per tab. Vivari's OPFS root, its preview routing and its
// service-worker relay are all per-origin, so a second instance would collide with this one
let containerPromise: Promise<Vivari> | undefined;

export function getContainer() {
	containerPromise ??= Vivari.boot();
	return containerPromise;
}

export function nodeDirectory(nodeId: string) {
	return `/${nodeId}`;
}

let persistence: Promise<boolean> | undefined;

// The VFS is best-effort storage by default, which WebKit clears after a week without a
// visit. Asked for by resources that own durable data rather than at boot, because
// Firefox prompts for it
export function requestPersistentStorage() {
	persistence ??= (async () => {
		if (!navigator.storage?.persist) return false;
		return (await navigator.storage.persisted()) || navigator.storage.persist();
	})().catch(() => false);
	return persistence;
}

const mounts = new Map<string, Promise<void>>();

// The editor and the orchestrator both need a node's files on disk, but they share one
// container, so whichever arrives first mounts and the other reuses it. Mounting twice
// would overwrite whatever the editor has written since the last save
export function mountNodeFiles(nodeId: string, files: FileSystemTree) {
	let mount = mounts.get(nodeId);
	if (!mount) {
		mount = (async () => {
			const container = await getContainer();
			await container.fs.mkdir(nodeDirectory(nodeId), { recursive: true });
			await container.mount(files, { mountPoint: nodeDirectory(nodeId) });
		})().catch((error) => {
			mounts.delete(nodeId);
			throw error;
		});
		mounts.set(nodeId, mount);
	}
	return mount;
}

// A deleted node's directory is the last thing holding its node_modules and whatever data
// the resource wrote, and the VFS outlives the page. Skipped when the container was never
// booted, so deleting a node cannot be what pays to start it
export async function removeNodeFiles(nodeId: string) {
	mounts.delete(nodeId);
	if (!containerPromise) return;
	const container = await containerPromise;
	await container.fs.rm(nodeDirectory(nodeId), { recursive: true, force: true });
}
