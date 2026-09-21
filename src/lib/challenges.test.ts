import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { INDEX_FORMAT, readChallengeFolder } from '$lib/challenges';

const FOLDER = 'static/challenges';

// The shipped folder, read the way the browser reads it, so what the catalogue would show is
// what is asserted
const serveFolder: typeof globalThis.fetch = async (input) => {
	const file = String(input).replace('/challenges/', '');
	try {
		return new Response(await readFile(`${FOLDER}/${file}`, 'utf8'));
	} catch {
		return new Response('', { status: 404 });
	}
};

const serve = (files: Record<string, string>): typeof globalThis.fetch => {
	return async (input) => {
		const body = files[String(input).replace('/challenges/', '')];
		return body === undefined ? new Response('', { status: 404 }) : new Response(body);
	};
};

describe('the challenges the app ships', () => {
	// Nothing checks these files as they are written, so this is the click on Start that would
	// otherwise find it: a goal naming a node the canvas does not have, a fixed setting the
	// resource does not have, a window no run closes
	it('reads every file the index lists, as a challenge with goals', async () => {
		const { challenges, unread } = await readChallengeFolder(serveFolder);
		expect(unread).toEqual([]);
		expect(challenges.length).toBeGreaterThan(0);
		for (const challenge of challenges) {
			expect(challenge.document.goals.length).toBeGreaterThan(0);
		}
	});

	it('names each one apart, since a started one is recorded by its id', async () => {
		const { challenges } = await readChallengeFolder(serveFolder);
		const ids = challenges.map((challenge) => challenge.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	// A challenge nobody listed is one nobody can start, which is not something to discover in
	// the catalogue
	it('lists every challenge in the folder', async () => {
		const index = JSON.parse(await readFile(`${FOLDER}/index.json`, 'utf8'));
		const listed: { file: string }[] = index.challenges;
		const files = (await readdir(FOLDER)).filter(
			(file) => file.endsWith('.json') && file !== 'index.json' && file !== 'schema.json'
		);
		expect(files.sort()).toEqual(listed.map((entry) => entry.file).sort());
	});
});

describe('readChallengeFolder', () => {
	const indexOf = (challenges: { id: string; file: string }[]) =>
		JSON.stringify({ format: INDEX_FORMAT, challenges });
	const index = (...files: string[]) => indexOf(files.map((file, i) => ({ id: `c${i}`, file })));

	it('keeps the challenges it could read and names the file it could not', async () => {
		const good = await readFile(`${FOLDER}/first-challenge.json`, 'utf8');
		const { challenges, unread } = await readChallengeFolder(
			serve({
				'index.json': index('first-challenge.json', 'broken.json'),
				'first-challenge.json': good,
				'broken.json': '{ not json'
			})
		);
		// By the id the index gives, so renaming the file keeps a reader's progress
		expect(challenges.map((challenge) => challenge.id)).toEqual(['c0']);
		expect(unread).toEqual([
			{ file: 'broken.json', problem: 'That file is not a Glass Garden project' }
		]);
	});

	it('names a file the folder lists but does not hold', async () => {
		const { unread } = await readChallengeFolder(serve({ 'index.json': index('missing.json') }));
		expect(unread).toEqual([{ file: 'missing.json', problem: 'The server answered 404' }]);
	});

	it('blames the index itself when that is what cannot be read', async () => {
		const broken = JSON.stringify({ format: INDEX_FORMAT, challenges: [{}] });
		const { challenges, unread } = await readChallengeFolder(serve({ 'index.json': broken }));
		expect(challenges).toEqual([]);
		expect(unread[0].file).toBe('index.json');
		expect(unread[0].problem).toContain('file');
	});

	it('refuses a bare list, which carries no format to read it by', async () => {
		const bare = JSON.stringify([{ id: 'a', file: 'a.json' }]);
		const { challenges, unread } = await readChallengeFolder(serve({ 'index.json': bare }));
		expect(challenges).toEqual([]);
		expect(unread[0].file).toBe('index.json');
	});

	it('refuses two entries sharing an id, which would share one reader’s progress', async () => {
		const twice = indexOf(['a.json', 'b.json'].map((file) => ({ id: 'same', file })));
		const { unread } = await readChallengeFolder(serve({ 'index.json': twice }));
		expect(unread[0].problem).toContain('Two challenges share the id "same"');
	});
});
