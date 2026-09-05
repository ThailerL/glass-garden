import { describe, expect, it } from 'vitest';
import { previewPath, toPreviewUrl } from './PreviewFrame.svelte';

const PREVIEW = 'http://localhost:3100/preview/7353/';

describe('previewPath', () => {
	it('reports the root for the base itself', () => {
		expect(previewPath(PREVIEW, PREVIEW)).toBe('/');
	});

	it('reports the path the app sees, not the proxy prefix', () => {
		expect(previewPath(`${PREVIEW}notes`, PREVIEW)).toBe('/notes');
		expect(previewPath(`${PREVIEW}notes/2024`, PREVIEW)).toBe('/notes/2024');
	});

	it('keeps the query, which is part of what the app was asked for', () => {
		expect(previewPath(`${PREVIEW}search?q=cat`, PREVIEW)).toBe('/search?q=cat');
	});

	it('falls back to the root for anywhere outside this instance', () => {
		expect(previewPath('http://localhost:3100/preview/9999/notes', PREVIEW)).toBe('/');
		expect(previewPath('http://example.com/notes', PREVIEW)).toBe('/');
	});

	it('accepts a base without its trailing slash', () => {
		expect(previewPath(`${PREVIEW}notes`, PREVIEW.slice(0, -1))).toBe('/notes');
	});
});

describe('toPreviewUrl', () => {
	it('sends an empty or root path to the base', () => {
		expect(toPreviewUrl(PREVIEW, '')).toBe(PREVIEW);
		expect(toPreviewUrl(PREVIEW, '/')).toBe(PREVIEW);
		expect(toPreviewUrl(PREVIEW, '   ')).toBe(PREVIEW);
	});

	it('takes a path with or without its leading slash', () => {
		expect(toPreviewUrl(PREVIEW, '/notes')).toBe(`${PREVIEW}notes`);
		expect(toPreviewUrl(PREVIEW, 'notes')).toBe(`${PREVIEW}notes`);
		expect(toPreviewUrl(PREVIEW, '//notes')).toBe(`${PREVIEW}notes`);
	});

	it('keeps a query string', () => {
		expect(toPreviewUrl(PREVIEW, '/search?q=cat')).toBe(`${PREVIEW}search?q=cat`);
	});

	it('keeps only the path and query of a pasted absolute URL', () => {
		expect(toPreviewUrl(PREVIEW, 'http://localhost:7353/notes?q=1')).toBe(`${PREVIEW}notes?q=1`);
		expect(toPreviewUrl(PREVIEW, 'https://example.com/notes')).toBe(`${PREVIEW}notes`);
	});

	it('will not climb out of the proxy prefix', () => {
		expect(toPreviewUrl(PREVIEW, '../../secret')).toBe(PREVIEW);
		expect(toPreviewUrl(PREVIEW, '/../../secret')).toBe(PREVIEW);
	});

	it('falls back to the base rather than throwing on nonsense', () => {
		expect(toPreviewUrl(PREVIEW, 'http://')).toBe(PREVIEW);
	});

	it('accepts a base without its trailing slash', () => {
		expect(toPreviewUrl(PREVIEW.slice(0, -1), '/notes')).toBe(`${PREVIEW}notes`);
	});

	it('round-trips with previewPath', () => {
		for (const path of ['/', '/notes', '/notes/2024', '/search?q=cat']) {
			expect(previewPath(toPreviewUrl(PREVIEW, path), PREVIEW)).toBe(path);
		}
	});
});
