import type { Handle } from '@sveltejs/kit';
import { ISOLATION_HEADERS } from '$lib/isolation-headers';

// Covers the pages SvelteKit renders; static files get the same headers from server.js or _headers
export const handle: Handle = ({ event, resolve }) => {
	event.setHeaders(ISOLATION_HEADERS);
	return resolve(event);
};
