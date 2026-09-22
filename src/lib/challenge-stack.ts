import type { ChallengeDocument } from './project-document';
import type { ResourceType } from './resources';

// Types only from the app's schema, so the content site can import this module too. It answers
// in resource types rather than names, which lets each side use the name lookup it already has

// The generator is the traffic rather than part of the system under test, and every challenge
// has one, so naming it distinguishes nothing for a reader comparing two cards
const HARNESS: ResourceType[] = ['requestGenerator'];

function distinct(types: ResourceType[]): ResourceType[] {
	return [...new Set(types)].filter((type) => !HARNESS.includes(type));
}

// What the reader is handed, left to right as the canvas draws it
export function startingResources(document: ChallengeDocument): ResourceType[] {
	return distinct(
		document.startingCanvas.nodes
			.toSorted((a, b) => a.position.x - b.position.x)
			.map((node) => node.type)
	);
}

// What they are likely to add, minus anything already on the canvas: a challenge that starts
// with a queue is not suggesting one
export function suggestedResources(document: ChallengeDocument): ResourceType[] {
	const starting = startingResources(document);
	return distinct(document.suggests).filter((type) => !starting.includes(type));
}

// A label and a list rather than a sentence: a resource is called "Queue (SQS)" so that the
// card, the palette and the canvas agree, and a name in that shape reads badly mid-sentence.
// One phrasing, since `suggests` means the same thing on every challenge
export function suggestionLine(names: string[]): string | undefined {
	if (names.length === 0) return undefined;
	return `Usually solved with: ${names.join(', ')}`;
}
