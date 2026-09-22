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

// Two facts in the card's corner rather than the page's sentence: the reader is scanning a
// list here, and the same words on every card are read as a shape rather than as prose
export function runFacts({ length, goals }: ChallengeDocument): string[] {
	return [`${length}s run`, goals.length === 1 ? '1 goal' : `${goals.length} goals`];
}

export function runSentence({ length, goals }: ChallengeDocument): string {
	const scored = goals.length === 1 ? '1 goal' : `${goals.length} goals`;
	return `A ${length}-second run, scored against ${scored}`;
}
