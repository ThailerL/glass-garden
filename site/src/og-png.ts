import { Resvg } from '@resvg/resvg-js';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decompress } from 'wawoff2';
import type { ChallengeDocument } from '../../src/lib/project-document';
import { cardSvg } from './og-card';

// The same Inter the pages load, so the card cannot drift onto another font
const WOFF2 = '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2';

// resvg reads no woff2 and falls back to a serif when handed a font as a buffer, so the decoded
// font is written out and passed by path. See .notes/search-indexing.md
async function interFontFile(): Promise<string> {
	const file = path.join(tmpdir(), 'glass-garden-inter.ttf');
	const woff2 = await readFile(createRequire(import.meta.url).resolve(WOFF2));
	// One fixed path rather than a fresh temp directory, which nothing would clean up
	await writeFile(file, Buffer.from(await decompress(woff2)));
	return file;
}

// One decode for the whole build, however many challenges ask for a card
let fontFile: Promise<string> | undefined;

export async function cardPng(document: ChallengeDocument): Promise<Buffer> {
	fontFile ??= interFontFile();
	const renderer = new Resvg(cardSvg(document), {
		font: { fontFiles: [await fontFile], loadSystemFonts: false, defaultFontFamily: 'Inter' }
	});
	return renderer.render().asPng();
}
