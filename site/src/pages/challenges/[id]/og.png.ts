import type { APIRoute } from 'astro';
import { challenges } from '../../../challenges';
import { cardPng } from '../../../og-png';

export function getStaticPaths() {
	return challenges().map((challenge) => ({ params: { id: challenge.id }, props: { challenge } }));
}

export const GET: APIRoute = async ({ props }) =>
	new Response(await cardPng(props.challenge.document), {
		headers: { 'content-type': 'image/png' }
	});
