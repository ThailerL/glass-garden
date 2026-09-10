const PARAM = 'project';
// Chat and email clients start truncating well before browsers do
const MAX_LINK_LENGTH = 32_000;

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: GenericTransformStream) {
	const response = new Response(new Response(bytes).body!.pipeThrough(stream));
	return new Uint8Array(await response.arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
	const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function encodeShareLink(document: string, origin: string): Promise<string> {
	const deflated = await pipe(
		new TextEncoder().encode(document),
		new CompressionStream('deflate-raw')
	);
	const link = `${origin}/#${PARAM}=${toBase64Url(deflated)}`;
	if (link.length > MAX_LINK_LENGTH) {
		throw new Error('This project is too large to share as a link. Export it instead.');
	}
	return link;
}

function sharedBlob(hash: string): string | null {
	return new URLSearchParams(hash.replace(/^#/, '')).get(PARAM);
}

export function hasSharedProject(hash: string): boolean {
	return sharedBlob(hash) !== null;
}

export async function decodeShareLink(hash: string): Promise<string> {
	try {
		const blob = sharedBlob(hash) ?? '';
		const inflated = await pipe(fromBase64Url(blob), new DecompressionStream('deflate-raw'));
		return new TextDecoder('utf-8', { fatal: true }).decode(inflated);
	} catch {
		throw new Error('That link is not a Glass Garden project');
	}
}
