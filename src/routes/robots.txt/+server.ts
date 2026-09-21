import { env } from '$env/dynamic/public';
import { robots } from '$lib/page-metadata';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
	new Response(robots(env.PUBLIC_ORIGIN), { headers: { 'content-type': 'text/plain' } });
