import { env } from '$env/dynamic/public';
import { parseProjectDocument } from './project-document';
import { deleteProject, getProject, importProject, setLastProjectId } from './projects.svelte';
import { decodeShareLink } from './share-link';
import { readEntry } from './storage';

export const embedded = window.self !== window.top;

const EMBED_KEY = 'embed';

type EmbeddedProject = { hash: string; projectId: string };

export function mainAppUrl(hash: string): string {
	return `${env.PUBLIC_ORIGIN || location.origin}/${hash}`;
}

// Reaching the container directly is how the README says to open a fresh install
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

// An embed's address opened in a tab of its own is an empty app on the wrong origin
export function leaveForMainApp(): boolean {
	const canonical = env.PUBLIC_ORIGIN?.replace(/\/$/, '');
	if (embedded || !canonical) return false;
	if (canonical === location.origin || LOOPBACK.includes(location.hostname)) return false;
	location.replace(mainAppUrl(location.hash));
	return true;
}

// The frame's src never changes, so a changed link is the only sign of a new project
export async function openEmbeddedProject(hash: string): Promise<string> {
	const previous = readEntry<EmbeddedProject>(EMBED_KEY);
	let projectId = previous?.hash === hash ? previous.projectId : undefined;

	if (!projectId || !getProject(projectId)) {
		// Imported before the old one goes, so a failure leaves what was there
		const project = await importProject(parseProjectDocument(await decodeShareLink(hash)));
		if (previous) deleteProject(previous.projectId);
		localStorage.setItem(EMBED_KEY, JSON.stringify({ hash, projectId: project.id }));
		projectId = project.id;
	}

	// Cleared on read, so nothing offers this link again
	history.replaceState(null, '', location.pathname);
	setLastProjectId(projectId);
	return projectId;
}
