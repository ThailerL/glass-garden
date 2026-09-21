import { env } from '$env/dynamic/public';
import { parseDocument } from './project-document';
import { deleteProject, importProject, listEmbedded, setLastProjectId } from './projects.svelte';
import { decodeShareLink } from './share-link';

export const embedded = window.self !== window.top;

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

// Versioned and documented in the README, since a host page's own code reads these
export const EMBED_FORMAT = 'gg:embed/1';

export type HostMessage =
	// 'best' carries every goal as well, so a page can show progress without knowing the challenge
	| { event: 'best'; met: readonly string[]; all: readonly string[] }
	| { event: 'run'; scored: true; met: readonly string[]; failed: readonly string[] }
	| { event: 'run'; scored: false; reason: 'did-not-start'; nodeName: string };

// Nothing in a message is private, so a host that sent no referrer still hears it
export function tellHost(message: HostMessage) {
	if (!embedded) return;
	const origin = URL.parse(document.referrer)?.origin ?? '*';
	window.parent.postMessage({ format: EMBED_FORMAT, ...message }, origin);
}

// Once rather than on every scroll: a reader who stops the lesson and scrolls back keeps it stopped
export function whenInView(callback: () => void) {
	const observer = new IntersectionObserver(([entry]) => {
		if (!entry.isIntersecting) return;
		observer.disconnect();
		callback();
	});
	observer.observe(document.documentElement);
}

// The frame's src never changes, so a changed link is the only sign of a new project. The
// reader's copy carries the link it came from, so a reset is found by the same search
export async function openEmbeddedProject(hash: string): Promise<string> {
	const copies = listEmbedded();
	let project = copies.find((copy) => copy.embedHash === hash);

	if (!project) {
		// Read before the import, which adds a copy of its own: every one here is of a link this
		// frame no longer shows
		const stale = copies.map((copy) => copy.id);
		// Imported before the old ones go, so a failure leaves what was there
		project = importProject(parseDocument(await decodeShareLink(hash)), { embedHash: hash });
		for (const id of stale) deleteProject(id);
	}

	// Cleared on read, so nothing offers this link again
	history.replaceState(null, '', location.pathname);
	setLastProjectId(project.id);
	return project.id;
}
