import {
	loadChallengeFolder,
	type BuiltInChallenge,
	type ChallengeFolder,
	type UnreadChallenge
} from './challenges';
import { listChallenges, type Project } from './projects.svelte';

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
	void loadChallengeFolder().then((read) => (folder = read));
}

// One walk, so every started challenge falls on exactly one side: ours to describe, or theirs
export function challengeCatalogue(): {
	builtIn: CatalogueEntry[];
	imported: readonly Project[];
	unread: readonly UnreadChallenge[];
	ready: boolean;
} {
	const started = listChallenges();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const shipped = new Set(folder?.challenges.map((entry) => entry.id));
	const builtIn = (folder?.challenges ?? []).map((entry) => {
		const project = started.find((p) => p.builtIn === entry.id);
		const goals = entry.document.goals.length;
		const best = project?.bestRun?.length ?? 0;
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
