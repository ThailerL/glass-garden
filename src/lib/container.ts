import { Vivari, type FileSystemTree } from '@vivari/core';
import { forgetImportedFiles } from './files/imported-files';

// Only one container is booted per tab. Vivari's OPFS root, its preview routing and its
// service-worker relay are all per-origin, so a second instance would collide with this one
let containerPromise: Promise<Vivari> | undefined;

// Run after the boot; failures are logged, never fatal
const bootTasks: ((container: Vivari) => Promise<void>)[] = [];
// What a late registration reads to see the boot pass has been made
let booted: Vivari | undefined;

export function onContainerBoot(task: (container: Vivari) => Promise<void>) {
	bootTasks.push(task);
	if (booted) void task(booted).catch(console.error);
}

export function getContainer() {
	containerPromise ??= Vivari.boot().then((container) => {
		booted = container;
		for (const task of bootTasks) void task(container).catch(console.error);
		return container;
	});
	return containerPromise;
}

export const PROJECTS_ROOT = '/projects';

// Ambient: set by GraphState, and a switch between projects reloads the page
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

export function nodeDirectory(nodeId: string, projectId?: string) {
	return `${projectId ? projectDirectory(projectId) : activeProjectDirectory()}/nodes/${nodeId}`;
}

// Where an admin shell works. Its own directory rather than the project root, which holds
// the region's saved state and the function manager - neither of which the editor shows
export function adminDirectory() {
	return `${activeProjectDirectory()}/admin`;
}

// Nothing lays this down the way a node's files are mounted, so the first shell makes it
export async function ensureAdminDirectory() {
	const container = await getContainer();
	await container.fs.mkdir(adminDirectory(), { recursive: true });
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
// `overwrite` re-lays ours for node's that we manage and can't be edited by the user.
// A write is persisted after the call resolves, so a page navigating at once loses it
export function mountNodeFiles(nodeId: string, files: FileSystemTree, overwrite = false) {
	const existing = mounts.get(nodeId);
	if (existing) return existing;

	const mount = (async () => {
		const container = await getContainer();
		const target = nodeDirectory(nodeId);
		if (overwrite || !(await container.fs.exists(target))) {
			await container.fs.mkdir(target, { recursive: true });
			await container.mount(files, { mountPoint: target });
		}
		// On disk now, so an import's held copy is spent
		forgetImportedFiles(nodeId);
	})().catch((error) => {
		mounts.delete(nodeId);
		throw error;
	});
	mounts.set(nodeId, mount);
	return mount;
}

// A deleted node's directory is the last thing holding its node_modules and whatever data
// the resource wrote, and the VFS outlives the page. Skipped when the container was never
// booted, so deleting a node cannot be what pays to start it
export async function removeNodeFiles(nodeId: string) {
	mounts.delete(nodeId);
	forgetImportedFiles(nodeId);
	if (!containerPromise) return;
	const container = await containerPromise;
	await container.fs.rm(nodeDirectory(nodeId), { recursive: true, force: true });
}

// Skipping while unbooted is safe here: the boot-time sweep removes orphaned project dirs
export async function removeProjectFiles(projectId: string, nodeIds: readonly string[]) {
	for (const nodeId of nodeIds) {
		mounts.delete(nodeId);
		forgetImportedFiles(nodeId);
	}
	if (!containerPromise) return;
	const container = await containerPromise;
	await container.fs.rm(projectDirectory(projectId), { recursive: true, force: true });
}
