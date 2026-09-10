import { embedded, leaveForMainApp } from '$lib/embed';
import {
	ensureProject,
	findProjectIdForNode,
	getLastProjectId,
	getProject,
	setLastProjectId
} from '$lib/projects.svelte';
import { hasSharedProject } from '$lib/share-link';
import { claimTabLock } from '$lib/tab-lock';
import type { LayoutLoad } from './$types';

export const ssr = false;

type Layout =
	| { state: 'notIsolated' }
	| { state: 'blocked' }
	| { state: 'embed'; hash: string }
	| { state: 'ready'; projectId: string };

// The project isn't in the URL, so it is settled here once for both routes
export const load: LayoutLoad = async ({ url }): Promise<Layout> => {
	// Never settles, because the page is on its way to another origin
	if (leaveForMainApp()) return new Promise<never>(() => {});
	// Nothing is claimed or created for a frame that cannot boot the VM
	if (embedded && !crossOriginIsolated) return { state: 'notIsolated' };
	// First, so a tab that may not run neither creates a project nor boots the VM
	if (!(await claimTabLock())) return { state: 'blocked' };
	// Settled by the layout, once the import has put the files in the VM
	if (embedded && hasSharedProject(url.hash)) return { state: 'embed', hash: url.hash };

	const [, section, nodeId] = url.pathname.split('/');
	// The editor can be reached directly while another project was last open, so it adopts
	// the project owning the node rather than leaving the canvas pointed somewhere else
	const fromNode = section === 'edit' && nodeId ? findProjectIdForNode(nodeId) : undefined;

	const projectId = fromNode ?? currentProjectId();
	setLastProjectId(projectId);
	return { state: 'ready', projectId };
};

function currentProjectId(): string {
	const last = getLastProjectId();
	if (last && getProject(last)) return last;
	return ensureProject().id;
}
