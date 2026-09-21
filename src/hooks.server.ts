import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { ISOLATION_HEADERS } from '$lib/isolation-headers';
import { headTags } from '$lib/page-metadata';

// Covers the pages SvelteKit renders; static files get the same headers from server.js or _headers
export const handle: Handle = ({ event, resolve }) => {
	event.setHeaders(ISOLATION_HEADERS);
	const tags = headTags(env.PUBLIC_ORIGIN, event.url.pathname);
	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('</head>', `${tags}</head>`)
	});
};
