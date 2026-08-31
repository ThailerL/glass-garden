import {
	ensureProject,
	findProjectIdForNode,
	getLastProjectId,
	getProject,
	setLastProjectId
} from '$lib/projects.svelte';
import type { LayoutLoad } from './$types';

export const ssr = false;

// The project isn't in the URL, so it is settled here once for both routes
export const load: LayoutLoad = ({ url }) => {
	const [, section, nodeId] = url.pathname.split('/');
	// The editor can be reached directly while another project was last open, so it adopts
	// the project owning the node rather than leaving the canvas pointed somewhere else
	const fromNode = section === 'edit' && nodeId ? findProjectIdForNode(nodeId) : undefined;

	const projectId = fromNode ?? currentProjectId();
	setLastProjectId(projectId);
	return { projectId };
};

function currentProjectId(): string {
	const last = getLastProjectId();
	if (last && getProject(last)) return last;
	return ensureProject().id;
}
