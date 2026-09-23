import { describe, expect, it } from 'vitest';
import { headTags, robots, sitemap } from './page-metadata';

describe('headTags', () => {
	it('describes an indexable page even when the deployment has no address', () => {
		const tags = headTags(undefined, '/');
		expect(tags).toContain('<meta name="description"');
		expect(tags).not.toContain('canonical');
		expect(tags).not.toContain('ld+json');
	});

	it('points the canonical at the public origin, whatever host served the page', () => {
		expect(headTags('https://glass.garden/', '/')).toContain(
			'<link rel="canonical" href="https://glass.garden/" />'
		);
	});

	it('puts the structured data on the home page', () => {
		const home = headTags('https://glass.garden', '/');
		const json = home.match(/<script type="application\/ld\+json">(.*)<\/script>/)?.[1];
		expect(JSON.parse(json ?? '')['@graph']).toMatchObject([
			{ '@type': 'WebSite', name: 'Glass Garden', url: 'https://glass.garden/' },
			{ '@type': 'SoftwareApplication', url: 'https://glass.garden/' }
		]);
	});

	it('keeps the catalogue out of search, since arriving there cold boots the VM for a list', () => {
		expect(headTags('https://glass.garden', '/challenges')).toBe(
			'<meta name="robots" content="noindex" />'
		);
	});

	it('keeps a page that is a view onto local projects out of search', () => {
		expect(headTags('https://glass.garden', '/edit/abc123')).toBe(
			'<meta name="robots" content="noindex" />'
		);
	});
});

describe('sitemap', () => {
	// The content site cannot write absolute URLs, so its pages are listed from here
	it('lists every crawlable page under the public origin, whichever build made it', () => {
		const xml = sitemap('https://glass.garden/');
		expect(xml).toContain('<loc>https://glass.garden/</loc>');
		expect(xml).toContain('<loc>https://glass.garden/about</loc>');
		expect(xml).toContain('<loc>https://glass.garden/about/challenges</loc>');
		expect(xml).toContain('<loc>https://glass.garden/about/challenges/slow-signups</loc>');
	});

	// It gives a crawler an empty shell, and the page meant to rank for it is /about/challenges
	it("leaves out the app's own catalogue", () => {
		expect(sitemap('https://glass.garden')).not.toContain(
			'<loc>https://glass.garden/challenges</loc>'
		);
	});

	it('does not exist without an address to put in it', () => {
		expect(sitemap(undefined)).toBeUndefined();
		expect(sitemap('')).toBeUndefined();
	});
});

describe('robots', () => {
	it('allows everything and names the one sitemap', () => {
		expect(robots('https://glass.garden')).toBe(
			'# allow crawling everything by default\nUser-agent: *\nDisallow:\n' +
				'Sitemap: https://glass.garden/sitemap.xml\n'
		);
	});

	it('leaves the sitemap out when the deployment has no address', () => {
		expect(robots(undefined)).not.toContain('Sitemap');
	});
});
