import index from '../../static/challenges/index.json';
import {
	startingResources,
	suggestedResources,
	suggestionLine
} from '../../src/lib/challenge-stack';
import type { BuiltInChallenge } from '../../src/lib/challenges';
import type { ChallengeDocument } from '../../src/lib/project-document';
import type { ResourceType } from '../../src/lib/resources';
import { resourceOf } from './resources';

// Type-only imports, so nothing the app's schema reaches for is pulled into this build. The
// files themselves are parsed against that schema by the app's own tests, which is why reading
// them here is a cast rather than a second validation

// Inlined at build time rather than read from disk: the pages are generated inside a bundle,
// which has no path back to the folder. The index and the schema are the folder's own files
// rather than challenges, and the schema is the largest thing in it
const documents = import.meta.glob(
	[
		'../../static/challenges/*.json',
		'!../../static/challenges/index.json',
		'!../../static/challenges/schema.json'
	],
	{ eager: true, import: 'default' }
) as Record<string, ChallengeDocument>;

// The catalogue's order, from the same index file the app reads
export function challenges(): BuiltInChallenge[] {
	return index.challenges.map(({ id, file }) => {
		const document = documents[`../../static/challenges/${file}`];
		if (!document) throw new Error(`${file} is listed in the challenge index but is not there`);
		return { id, document };
	});
}

// Search wording, not catalogue wording. Keep each under 45 characters: the suffix costs 15 of
// the 60 a result line shows. Site copy, since the app never shows either of these
const SEARCH_TITLES: Record<string, string> = {
	'first-challenge': 'Connect a load balancer to a Node app',
	oversold: 'An in-memory count breaks when you scale out',
	'slow-signups': 'Move password hashing off the request path'
};

// The claim leads rather than trails, since a search result trims the end
export function pageMeta({ id, document }: BuiltInChallenge) {
	const searchTitle = SEARCH_TITLES[id];
	if (!searchTitle) throw new Error(`${id} has no search title in site/src/challenges.ts`);
	return {
		title: `${searchTitle} · Glass Garden`,
		shareTitle: document.title,
		description: `Real code, running in your browser. ${document.description}`
	};
}

const namesOf = (types: ResourceType[]) => types.map((type) => resourceOf(type).name);

// Spelled out as well as drawn: a reader arriving from a search result has not seen the icons
// before, and these names are the words that brought them here
export function stackNames(document: ChallengeDocument): string {
	return namesOf(startingResources(document)).join(', ');
}

// Said in words here rather than left to the "+" in the icon row, because this reader is
// deciding whether to click and cannot read the icons yet
export function suggestionOf(document: ChallengeDocument): string | undefined {
	return suggestionLine(namesOf(suggestedResources(document)));
}

export function goalCount({ goals }: ChallengeDocument): string {
	return goals.length === 1 ? '1 goal' : `${goals.length} goals`;
}

// Two facts in the card's corner rather than the page's sentence: the reader is scanning a
// list here, and the same words on every card are read as a shape rather than as prose
export function runFacts(document: ChallengeDocument): string[] {
	return [`${document.length}s run`, goalCount(document)];
}

export function runSentence(document: ChallengeDocument): string {
	return `A ${document.length}-second run, scored against ${goalCount(document)}`;
}
