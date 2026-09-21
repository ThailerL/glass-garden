import { z } from 'zod';
import { messageOf } from './errors';
import { CHALLENGE_FORMAT, parseDocument, type ChallengeDocument } from './project-document';

// Files rather than code, so running your own is replacing a folder (README, "Your own challenges")
const FOLDER = '/challenges';
const INDEX = 'index.json';

export type BuiltInChallenge = {
	id: string;
	document: ChallengeDocument;
};

// The folder's own file: the catalogue's order, and each challenge's identity in this folder.
// Every word on a card is the document's, so the card reads the same wherever it came from
const indexSchema = z
	.array(
		z.strictObject({
			// What a reader's progress is stored against, so a renamed file keeps it
			id: z.string().min(1),
			file: z.string().min(1)
		})
	)
	.superRefine((entries, ctx) => {
		const seen = new Set<string>();
		for (const { id } of entries) {
			if (seen.has(id)) {
				ctx.addIssue({ code: 'custom', message: `Two challenges share the id "${id}"` });
			}
			seen.add(id);
		}
	});

export type UnreadChallenge = { file: string; problem: string };

export type ChallengeFolder = {
	challenges: readonly BuiltInChallenge[];
	// Anyone edits this folder, so a file that will not parse is named rather than left a gap
	unread: readonly UnreadChallenge[];
};

async function readFile(fetch: typeof globalThis.fetch, file: string): Promise<string> {
	const response = await fetch(`${FOLDER}/${file}`);
	if (!response.ok) throw new Error(`The server answered ${response.status}`);
	return response.text();
}

const problemOf = (error: unknown) =>
	error instanceof z.ZodError ? z.prettifyError(error) : messageOf(error);

async function readChallenge(
	fetch: typeof globalThis.fetch,
	{ id, file }: z.infer<typeof indexSchema>[number]
): Promise<BuiltInChallenge | UnreadChallenge> {
	try {
		const document = parseDocument(await readFile(fetch, file));
		if (document.format !== CHALLENGE_FORMAT) {
			throw new Error('That file holds a project rather than a challenge');
		}
		return { id, document };
	} catch (error) {
		return { file, problem: problemOf(error) };
	}
}

export async function readChallengeFolder(
	fetch: typeof globalThis.fetch = globalThis.fetch
): Promise<ChallengeFolder> {
	let listed: z.infer<typeof indexSchema>;
	try {
		listed = indexSchema.parse(JSON.parse(await readFile(fetch, INDEX)));
	} catch (error) {
		// Nothing is listed, so there is no challenge to name but the list itself
		return { challenges: [], unread: [{ file: INDEX, problem: problemOf(error) }] };
	}

	const challenges: BuiltInChallenge[] = [];
	const unread: UnreadChallenge[] = [];
	for (const entry of await Promise.all(listed.map((e) => readChallenge(fetch, e)))) {
		if ('document' in entry) challenges.push(entry);
		else unread.push(entry);
	}
	return { challenges, unread };
}

let reading: Promise<ChallengeFolder> | undefined;

// Read once a session: the catalogue page and the sidebar's count both ask for it
export function loadChallengeFolder(): Promise<ChallengeFolder> {
	return (reading ??= readChallengeFolder());
}
