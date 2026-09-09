import {
	ensureProject,
	findProjectIdForNode,
	getLastProjectId,
	getProject,
	setLastProjectId
} from '$lib/projects.svelte';
import { claimTabLock } from '$lib/tab-lock';
import type { LayoutLoad } from './$types';

export const ssr = false;

// The project isn't in the URL, so it is settled here once for both routes
export const load: LayoutLoad = async ({ url }) => {
	// First, so a tab that may not run neither creates a project nor boots the VM
	if (!(await claimTabLock())) return { blocked: true as const };

	const [, section, nodeId] = url.pathname.split('/');
	// The editor can be reached directly while another project was last open, so it adopts
	// the project owning the node rather than leaving the canvas pointed somewhere else
	const fromNode = section === 'edit' && nodeId ? findProjectIdForNode(nodeId) : undefined;

	const projectId = fromNode ?? currentProjectId();
	setLastProjectId(projectId);
	return { blocked: false as const, projectId };
};

function currentProjectId(): string {
	const last = getLastProjectId();
	if (last && getProject(last)) return last;
	return ensureProject().id;
}
