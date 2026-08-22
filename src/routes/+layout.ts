import { createFileDB } from '$lib/file-state.svelte';
import type { LayoutLoad } from './$types';

export const ssr = false;

export const load: LayoutLoad = async () => {
	const db = await createFileDB();
	return { db };
};
