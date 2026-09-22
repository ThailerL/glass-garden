import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { parseDocument } from '$lib/project-document';

const DEMO = 'site/src/demo';

// The About page embeds this canvas as a share link. The Astro build cannot parse it, because
// parseDocument reaches the resource registry and that pulls in Svelte components, so the check
// lives here: a typo would otherwise ship a link the app refuses in the page's own hero
async function filesUnder(directory: string, prefix = ''): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = `${directory}/${entry.name}`;
		const key = `${prefix}${entry.name}`;
		if (entry.isDirectory()) Object.assign(files, await filesUnder(path, `${key}/`));
		else files[key] = await readFile(path, 'utf8');
	}
	return files;
}

describe('the About page demo canvas', () => {
	it('is a project document the app would accept', async () => {
		const canvas = JSON.parse(await readFile(`${DEMO}/canvas.json`, 'utf8'));
		const document = { ...canvas, nodeFiles: { app: await filesUnder(`${DEMO}/app`) } };

		const parsed = parseDocument(JSON.stringify(document));
		expect(parsed.format).toBe('gg:project/1');
	});
});
