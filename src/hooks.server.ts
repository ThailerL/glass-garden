import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { createInitialModeExpression } from 'mode-watcher';
import { ISOLATION_HEADERS } from '$lib/isolation-headers';
import { headTags } from '$lib/page-metadata';

// ModeWatcher's own copy only runs once the bundle has, too late for the first paint
const INITIAL_MODE = createInitialModeExpression();

// Covers the pages SvelteKit renders; static files get the same headers from server.js or _headers
export const handle: Handle = ({ event, resolve }) => {
	event.setHeaders(ISOLATION_HEADERS);
	const tags = headTags(env.PUBLIC_ORIGIN, event.url.pathname);
	return resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace('</head>', `${tags}<script>${INITIAL_MODE}</script></head>`)
	});
};
