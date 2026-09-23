import {
	loadChallengeFolder,
	type BuiltInChallenge,
	type ChallengeFolder,
	type UnreadChallenge
} from './challenges';
import { goalIds } from './challenge';
import {
	adoptNewVersion,
	getLastProjectId,
	getProject,
	listChallenges,
	type ChallengeProject,
	type Project
} from './projects.svelte';

export type CatalogueEntry = {
	entry: BuiltInChallenge;
	title: string;
	goals: number;
	// The record, where the reader has started it
	started?: Project;
	best: number;
	complete: boolean;
};

// Undefined until the folder lands, so nothing is sorted before there is anything to sort by
let folder = $state<ChallengeFolder>();

export function loadCatalogue(): void {
	void loadChallengeFolder().then((read) => {
		// Every record but the open one, whose canvas is already built: that one was brought up to
		// date by the layout's load, before there was a canvas to write behind
		const open = getLastProjectId();
		for (const entry of read.challenges) {
			const project = listChallenges().find((p) => p.builtIn === entry.id);
			if (project && project.id !== open) adoptNewVersion(project, entry.document);
		}
		folder = read;
	});
}

// Called from the layout's load, so a newer version's nodes and settings are in place before the
// canvas reads them. Only waits on the folder for a project that came from it
export async function adoptOpenChallenge(projectId: string): Promise<void> {
	const project = getProject(projectId);
	if (!project?.builtIn) return;
	const { challenges } = await loadChallengeFolder();
	const entry = challenges.find((challenge) => challenge.id === project.builtIn);
	if (entry) adoptNewVersion(project, entry.document);
}

// One walk, so every started challenge falls on exactly one side: ours to describe, or theirs
export function challengeCatalogue(): {
	builtIn: CatalogueEntry[];
	imported: readonly ChallengeProject[];
	unread: readonly UnreadChallenge[];
	ready: boolean;
} {
	const started = listChallenges();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const shipped = new Set(folder?.challenges.map((entry) => entry.id));
	const builtIn = (folder?.challenges ?? []).map((entry) => {
		const project = started.find((p) => p.builtIn === entry.id);
		const ids = goalIds(entry.document);
		// Only against goals this version still has: a run scored on a goal since dropped or
		// renamed would otherwise count towards a total that no longer holds it
		const best = project?.bestRun?.filter((id) => ids.includes(id)).length ?? 0;
		const goals = ids.length;
		return {
			entry,
			title: entry.document.title,
			goals,
			best,
			complete: best === goals,
			started: project
		};
	});
	// Before the folder lands, only a challenge with no entry at all is certainly the reader's
	const imported = started.filter((p) => !p.builtIn || (!!folder && !shipped.has(p.builtIn)));
	return { builtIn, imported, unread: folder?.unread ?? [], ready: folder !== undefined };
}
