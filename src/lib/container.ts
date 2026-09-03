import { Vivari, type FileSystemTree } from '@vivari/core';

// Only one container is booted per tab. Vivari's OPFS root, its preview routing and its
// service-worker relay are all per-origin, so a second instance would collide with this one
let containerPromise: Promise<Vivari> | undefined;

// A boot waits on this rather than racing it. A container cannot be torn down until it has
// finished booting, and a shutdown mid-boot would otherwise leave two of them
let teardownComplete = Promise.resolve();

// Run after every boot; failures are logged, never fatal
const bootTasks: ((container: Vivari) => Promise<void>)[] = [];

export function onContainerBoot(task: (container: Vivari) => Promise<void>) {
	bootTasks.push(task);
}

export function getContainer() {
	containerPromise ??= teardownComplete.then(async () => {
		const container = await Vivari.boot();
		for (const task of bootTasks) void task(container).catch(console.error);
		return container;
	});
	return containerPromise;
}

// Run before teardown so state can be flushed while processes are still alive; bounded,
// so a hung task cannot block the next boot
const shutdownTasks: (() => Promise<void>)[] = [];

export function onContainerShutdown(task: () => Promise<void>) {
	shutdownTasks.push(task);
}

export function shutdownContainer() {
	const booted = containerPromise;
	containerPromise = undefined;
	mounts.clear();
	if (!booted) return;
	// A failed boot has nothing to tear down, and must not hold up the next one
	teardownComplete = booted.then(
		async (container) => {
			await Promise.race([
				Promise.allSettled(shutdownTasks.map((task) => task())),
				new Promise((resolve) => setTimeout(resolve, 5000))
			]);
			container.teardown();
		},
		() => {}
	);
}

export const PROJECTS_ROOT = '/projects';

// Ambient: GraphState.switchTo is the single writer, and a switch tears the container down
let activeProjectId: string | undefined;

export function setActiveProject(projectId: string) {
	activeProjectId = projectId;
}

export function projectDirectory(projectId: string) {
	return `${PROJECTS_ROOT}/${projectId}`;
}

export function activeProjectDirectory() {
	if (!activeProjectId) throw new Error('No active project');
	return projectDirectory(activeProjectId);
}

export function nodeDirectory(nodeId: string) {
	return `${activeProjectDirectory()}/nodes/${nodeId}`;
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

// The editor and the orchestrator share one container, so whichever wants a node's files
// first mounts them. The VFS keeps every edit since, so a template is laid down once;
// `overwrite` re-lays ours for node's that we manage and can't be edited by the user
export function mountNodeFiles(nodeId: string, files: FileSystemTree, overwrite = false) {
	return mountOnce(nodeId, () => nodeDirectory(nodeId), files, overwrite);
}

// Files every node of a kind runs but none owns, laid down once per project outside any
// node's directory so the editor never shows them
export function mountSharedFiles(name: string, files: FileSystemTree) {
	return mountOnce(`shared:${name}`, () => `${activeProjectDirectory()}/${name}`, files, true);
}

function mountOnce(
	key: string,
	directory: () => string,
	files: FileSystemTree,
	overwrite: boolean
) {
	const existing = mounts.get(key);
	if (existing) return existing;

	const mount = (async () => {
		const container = await getContainer();
		const target = directory();
		if (!overwrite && (await container.fs.exists(target))) return;
		await container.fs.mkdir(target, { recursive: true });
		await container.mount(files, { mountPoint: target });
	})().catch((error) => {
		mounts.delete(key);
		throw error;
	});
	mounts.set(key, mount);
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

// Skipping while unbooted is safe here: the boot-time sweep removes orphaned project dirs
export async function removeProjectFiles(projectId: string, nodeIds: readonly string[]) {
	for (const nodeId of nodeIds) mounts.delete(nodeId);
	if (!containerPromise) return;
	const container = await containerPromise;
	await container.fs.rm(projectDirectory(projectId), { recursive: true, force: true });
}
