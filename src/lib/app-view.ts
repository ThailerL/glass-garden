export type AppView =
	{ name: 'canvas' } | { name: 'challenges' } | { name: 'edit'; nodeId: string };

export function appView(url: URL): AppView {
	const nodeId = url.searchParams.get('edit');
	if (nodeId) return { name: 'edit', nodeId };
	if (url.searchParams.has('challenges')) return { name: 'challenges' };
	return { name: 'canvas' };
}

// The content site writes it too, as the Start button's link
export function challengeAddress(id: string): `/?challenge=${string}` {
	return `/?challenge=${encodeURIComponent(id)}`;
}
