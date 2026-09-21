import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { sitemap } from '$lib/page-metadata';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const xml = sitemap(env.PUBLIC_ORIGIN);
	if (!xml) error(404, 'Not found');
	return new Response(xml, { headers: { 'content-type': 'application/xml' } });
};
