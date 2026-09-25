import challengeIndex from '../../static/data/challenges/index.json';
import { aboutPath, challengePath, challengesPath } from '../../site/src/paths';

type PageMetadata = { description: string };

// The app's own pages worth a search result; everything else is a view onto one browser's
// own projects. Static files never reach the hook, so the content site is not here
const PAGES: Record<string, PageMetadata> = {
	'/': {
		description:
			'Drag-and-drop cloud architecture that actually runs, entirely in your browser. Load balancers, Node apps, Postgres, Lambda, S3, and SQS, with nothing to install.'
	}
};

// Everything crawlable, whichever build produced it. The content site cannot write absolute
// URLs, since only the running deployment knows its address
const CRAWLABLE = [
	...Object.keys(PAGES),
	aboutPath,
	challengesPath,
	...challengeIndex.challenges.map(({ id }) => challengePath(id))
];

export function trimOrigin(origin: string | undefined): string | undefined {
	return origin?.replace(/\/$/, '') || undefined;
}

function escapeAttribute(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

// A "</script>" inside the JSON would otherwise end the element
export function jsonLd(data: unknown): string {
	return `<script type="application/ld+json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`;
}

function structuredData(origin: string, description: string): string {
	return jsonLd({
		'@context': 'https://schema.org',
		'@graph': [
			// Only the home page is read for the name printed above a search result, and only
			// from WebSite, so without this one Google falls back to the bare domain
			{ '@type': 'WebSite', name: 'Glass Garden', url: `${origin}/` },
			{
				'@type': 'SoftwareApplication',
				name: 'Glass Garden',
				url: `${origin}/`,
				description,
				applicationCategory: 'DeveloperApplication',
				operatingSystem: 'Any',
				offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
				license: 'https://www.gnu.org/licenses/agpl-3.0.html',
				sameAs: 'https://github.com/ThailerL/glass-garden'
			}
		]
	});
}

export function headTags(publicOrigin: string | undefined, pathname: string): string {
	const page = PAGES[pathname];
	// Anything outside the table is one browser's own projects, so keep it out of search
	if (!page) return '<meta name="robots" content="noindex" />';

	const tags = [`<meta name="description" content="${escapeAttribute(page.description)}" />`];
	const origin = trimOrigin(publicOrigin);
	if (origin) {
		tags.push(`<link rel="canonical" href="${escapeAttribute(origin + pathname)}" />`);
		if (pathname === '/') tags.push(structuredData(origin, page.description));
	}
	return tags.join('\n');
}

export function sitemap(publicOrigin: string | undefined): string | undefined {
	const origin = trimOrigin(publicOrigin);
	if (!origin) return undefined;

	const urls = CRAWLABLE.map((pathname) => `<url><loc>${origin}${pathname}</loc></url>`);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...urls,
		'</urlset>',
		''
	].join('\n');
}

export function robots(publicOrigin: string | undefined): string {
	const lines = ['# allow crawling everything by default', 'User-agent: *', 'Disallow:'];
	const origin = trimOrigin(publicOrigin);
	if (origin) lines.push(`Sitemap: ${origin}/sitemap.xml`);
	return `${lines.join('\n')}\n`;
}
