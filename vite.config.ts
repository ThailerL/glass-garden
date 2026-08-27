import path from 'node:path';
import { readdir } from 'node:fs/promises';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { snapshot } from '@webcontainer/snapshot';

const SNAPSHOT_MODULE = 'virtual:webcontainer-snapshots';
const RESOLVED_SNAPSHOT_MODULE = `\0${SNAPSHOT_MODULE}`;
const SOURCE_DIRECTORY = 'resources';

// Exports one binary snapshot per directory under resources/, named after it in camel case
// so the keys line up with ResourceType. Keeps the resource sources plain files rather than
// escaped template literals
function webcontainerSnapshots(): Plugin {
	return {
		name: 'webcontainer-snapshots',
		resolveId(id) {
			if (id === SNAPSHOT_MODULE) return RESOLVED_SNAPSHOT_MODULE;
		},
		async load(id) {
			if (id !== RESOLVED_SNAPSHOT_MODULE) return;

			const directories = await readdir(SOURCE_DIRECTORY, { withFileTypes: true });
			const exports = await Promise.all(
				directories
					.filter((entry) => entry.isDirectory())
					.map(async (entry) => {
						const buffer = await snapshot(path.join(SOURCE_DIRECTORY, entry.name));
						const name = entry.name.replace(/-(.)/g, (_, character) => character.toUpperCase());
						return `export const ${name} = Uint8Array.from(atob('${buffer.toString('base64')}'), (c) => c.charCodeAt(0));`;
					})
			);
			return exports.join('\n');
		},
		configureServer(server) {
			const root = path.resolve(SOURCE_DIRECTORY);
			server.watcher.add(root);
			server.watcher.on('all', (_event, file) => {
				if (!file.startsWith(root)) return;

				const module = server.moduleGraph.getModuleById(RESOLVED_SNAPSHOT_MODULE);
				if (module) server.moduleGraph.invalidateModule(module);
				server.ws.send({ type: 'full-reload' });
			});
		}
	};
}

export default defineConfig({
	plugins: [
		webcontainerSnapshots(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: {
					async: true
				}
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	]
});
