import { describe, it, expect } from 'vitest';
import { decodeShareLink, encodeShareLink, hasSharedProject } from '$lib/share-link';

const origin = 'https://garden.example';

describe('share links', () => {
	it('round-trips a document through the fragment', async () => {
		const document = JSON.stringify({
			format: 'gg:project/1',
			name: 'Queue app',
			files: 'ünïcode'
		});
		const link = await encodeShareLink(document, origin);
		expect(link.startsWith(`${origin}/#project=`)).toBe(true);
		expect(link.split('=')[1]).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(await decodeShareLink(new URL(link).hash)).toBe(document);
	});

	it('compresses repetitive text', async () => {
		const document = 'const x = 1;\n'.repeat(500);
		const link = await encodeShareLink(document, origin);
		expect(link.length).toBeLessThan(document.length / 10);
	});

	it('refuses a link that would be too long', async () => {
		const document = Array.from({ length: 4000 }, () => Math.random().toString(36)).join('');
		await expect(encodeShareLink(document, origin)).rejects.toThrow('too large to share as a link');
	});

	it('tells a share link from any other hash', async () => {
		expect(hasSharedProject(new URL(await encodeShareLink('{}', origin)).hash)).toBe(true);
		expect(hasSharedProject('')).toBe(false);
		expect(hasSharedProject('#other=1')).toBe(false);
	});

	it('rejects a fragment that does not inflate', async () => {
		await expect(decodeShareLink('#project=not-deflated')).rejects.toThrow(
			'not a Glass Garden project'
		);
	});
});
