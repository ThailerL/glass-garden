import { encodeShareLink } from '../../../src/lib/share-link';
import canvas from './canvas.json' with { type: 'json' };

// The app's files are ordinary files here rather than escaped strings in the document, so they
// can be edited and read like the code they are. Inlined at build time, since reading them by
// path would look for them beside the bundled chunk
const sources = import.meta.glob('./app/**/*', { query: '?raw', import: 'default', eager: true });

function appFiles(): Record<string, string> {
	return Object.fromEntries(
		Object.entries(sources).map(([path, contents]) => [
			path.replace('./app/', ''),
			contents as string
		])
	);
}

// Origin-less: the page fills it in, since only the running deployment knows its own address.
// `?start` runs the canvas once the frame is scrolled into view
export async function embedPath(): Promise<string> {
	const document = { ...canvas, nodeFiles: { app: appFiles() } };
	const link = await encodeShareLink(JSON.stringify(document), '');
	return link.replace('/#', '/?start#');
}
