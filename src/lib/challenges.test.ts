import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { readChallengeFolder } from '$lib/challenges';

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
			expect(Object.keys(challenge.document.goals).length).toBeGreaterThan(0);
		}
	});

	it('names each one apart, since a started one is recorded by the file it came from', async () => {
		const { challenges } = await readChallengeFolder(serveFolder);
		const ids = challenges.map((challenge) => challenge.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	// A challenge nobody listed is one nobody can start, which is not something to discover in
	// the catalogue
	it('lists every challenge in the folder', async () => {
		const { challenges } = await readChallengeFolder(serveFolder);
		const files = (await readdir(FOLDER)).filter(
			(file) => file.endsWith('.json') && file !== 'index.json' && file !== 'schema.json'
		);
		expect(files.sort()).toEqual(challenges.map((challenge) => `${challenge.id}.json`).sort());
	});
});

describe('readChallengeFolder', () => {
	const index = (...files: string[]) =>
		JSON.stringify(files.map((file) => ({ file, description: 'A challenge', stack: 'One node' })));

	it('keeps the challenges it could read and names the file it could not', async () => {
		const good = await readFile(`${FOLDER}/first-challenge.json`, 'utf8');
		const { challenges, unread } = await readChallengeFolder(
			serve({
				'index.json': index('first-challenge.json', 'broken.json'),
				'first-challenge.json': good,
				'broken.json': '{ not json'
			})
		);
		expect(challenges.map((challenge) => challenge.id)).toEqual(['first-challenge']);
		expect(unread).toEqual([
			{ file: 'broken.json', problem: 'That file is not a Glass Garden project' }
		]);
	});

	it('names a file the folder lists but does not hold', async () => {
		const { unread } = await readChallengeFolder(serve({ 'index.json': index('missing.json') }));
		expect(unread).toEqual([{ file: 'missing.json', problem: 'The server answered 404' }]);
	});

	it('blames the index itself when that is what cannot be read', async () => {
		const { challenges, unread } = await readChallengeFolder(serve({ 'index.json': '[{}]' }));
		expect(challenges).toEqual([]);
		expect(unread[0].file).toBe('index.json');
		expect(unread[0].problem).toContain('file');
	});
});
