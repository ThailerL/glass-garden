import { WebContainer, type FileSystemTree } from '@webcontainer/api';

// Only one WebContainer can be booted per tab
let webContainerPromise: Promise<WebContainer> | undefined;

export function getWebContainer() {
	webContainerPromise ??= WebContainer.boot({ workdirName: 'infralab' });
	return webContainerPromise;
}

const mounts = new Map<string, Promise<void>>();

// The editor and the orchestrator both need a node's files on disk, but they share one
// container, so whichever arrives first mounts and the other reuses it. Mounting twice
// would overwrite whatever the editor has written since the last save
export function mountNodeFiles(nodeId: string, files: FileSystemTree) {
	let mount = mounts.get(nodeId);
	if (!mount) {
		mount = (async () => {
			const webContainer = await getWebContainer();
			await webContainer.fs.mkdir(nodeId, { recursive: true });
			await webContainer.mount(files, { mountPoint: nodeId });
		})().catch((error) => {
			mounts.delete(nodeId);
			throw error;
		});
		mounts.set(nodeId, mount);
	}
	return mount;
}
