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
