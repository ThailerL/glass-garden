import { createFileDB } from '$lib/file-store.svelte';
import type { LayoutLoad } from './$types';

export const ssr = false;

export const load: LayoutLoad = async () => {
	const db = await createFileDB();
	return { db };
};
