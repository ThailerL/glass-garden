import { appView } from '$lib/app-view';
import { adoptOpenChallenge, linkedChallenge } from '$lib/challenge-catalogue.svelte';
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
	| { state: 'embed'; hash: string; start: boolean }
	| { state: 'ready'; projectId: string; unknownChallenge?: string };

// The project isn't in the URL, so it is settled here once for every view
export const load: LayoutLoad = async ({ url }): Promise<Layout> => {
	// Never settles, because the page is on its way to another origin
	if (leaveForMainApp()) return new Promise<never>(() => {});
	// Nothing is claimed or created for a frame that cannot boot the VM
	if (embedded && !crossOriginIsolated) return { state: 'notIsolated' };
	// First, so a tab that may not run neither creates a project nor boots the VM
	if (!(await claimTabLock())) return { state: 'blocked' };
	// Settled by the layout, once the import has put the files in the VM. Read off location:
	// Kit's dev server throws on url.hash inside a load, and the release build only on the server
	if (embedded && hasSharedProject(location.hash)) {
		return { state: 'embed', hash: location.hash, start: url.searchParams.has('start') };
	}

	const view = appView(url);
	// The editor can be reached directly while another project was last open, so it adopts
	// the project owning the node rather than leaving the canvas pointed somewhere else
	const fromNode = view.name === 'edit' ? findProjectIdForNode(view.nodeId) : undefined;
	const challenge = url.searchParams.get('challenge');
	const linked = challenge ? await linkedChallenge(challenge) : undefined;

	const projectId = fromNode ?? linked ?? currentProjectId();
	setLastProjectId(projectId);
	// A challenge the shipped folder has moved on from catches up here, before its canvas is built
	await adoptOpenChallenge(projectId);
	const unknownChallenge = challenge && !linked ? challenge : undefined;
	return { state: 'ready', projectId, unknownChallenge };
};

function currentProjectId(): string {
	const last = getLastProjectId();
	if (last && getProject(last)) return last;
	return ensureProject().id;
}
