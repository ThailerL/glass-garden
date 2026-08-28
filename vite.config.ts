import path from 'node:path';
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Connect, type Plugin } from 'vite';
// Type-only: erased at compile time, so this browser-only package is never actually
// loaded by the Node build. Keep it `import type`
import type { FileSystemTree } from '@vivari/core';

const RESOURCE_FILES_MODULE = 'virtual:resource-files';
const RESOLVED_RESOURCE_FILES_MODULE = `\0${RESOURCE_FILES_MODULE}`;
const SOURCE_DIRECTORY = 'resources';

const decoder = new TextDecoder('utf-8', { fatal: true });

async function readTree(directory: string): Promise<FileSystemTree> {
	const entries = await readdir(directory, { withFileTypes: true });
	const tree: FileSystemTree = {};
	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			tree[entry.name] = { directory: await readTree(entryPath) };
			continue;
		}
		if (!entry.isFile()) continue;
		try {
			tree[entry.name] = { file: { contents: decoder.decode(await readFile(entryPath)) } };
		} catch {
			throw new Error(`${entryPath} is not valid UTF-8; resource templates must be text files`);
		}
	}
	return tree;
}

// Exports one file tree per directory under resources/, named after it in camel case so
// the keys line up with ResourceType. Keeps the resource sources plain files rather than
// escaped template literals
function resourceFiles(): Plugin {
	return {
		name: 'resource-files',
		resolveId(id) {
			if (id === RESOURCE_FILES_MODULE) return RESOLVED_RESOURCE_FILES_MODULE;
		},
		async load(id) {
			if (id !== RESOLVED_RESOURCE_FILES_MODULE) return;

			const directories = await readdir(SOURCE_DIRECTORY, { withFileTypes: true });
			const exports = await Promise.all(
				directories
					.filter((entry) => entry.isDirectory())
					.map(async (entry) => {
						const tree = await readTree(path.join(SOURCE_DIRECTORY, entry.name));
						const name = entry.name.replace(/-(.)/g, (_, character) => character.toUpperCase());
						return `export const ${name} = ${JSON.stringify(tree)};`;
					})
			);
			return exports.join('\n');
		},
		configureServer(server) {
			const root = path.resolve(SOURCE_DIRECTORY);
			server.watcher.add(root);
			server.watcher.on('all', (_event, file) => {
				if (!file.startsWith(root)) return;

				const module = server.moduleGraph.getModuleById(RESOLVED_RESOURCE_FILES_MODULE);
				if (module) server.moduleGraph.invalidateModule(module);
				server.ws.send({ type: 'full-reload' });
			});
		}
	};
}

// Vivari loads its runtime by root-absolute URL - the kernel worker is
// `new Worker(new URL('/assets/kernel-worker-<hash>.js', ...))` - so Vite has nothing relative
// to trace and emits none of it. Copied out of the installed package under the names the SDK
// asks for: workers to /assets/, and sw.js to the root so its default scope covers every
// /preview/<port>/. The kernel also fetches /vendor/*-pack.bin, which
// scripts/vendor-assets.mjs generates.
function vivariAssets(): Plugin {
	const require = createRequire(import.meta.url);
	const sourceDirectory = path.join(
		path.dirname(require.resolve('@vivari/core/package.json')),
		'dist/assets'
	);
	// sw.js is the one asset that must land at the root rather than under /assets/
	const servedName = (name: string) => (name === 'sw.js' ? name : `assets/${name}`);

	return {
		name: 'vivari-assets',
		configureServer(server) {
			server.middlewares.use(async (request, response, next) => {
				const requested = (request.url ?? '').split('?')[0].replace(/^\//, '');
				const name = path.basename(requested);
				if (!name || servedName(name) !== requested) return next();

				try {
					const contents = await readFile(path.join(sourceDirectory, name));
					response.setHeader(
						'content-type',
						name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'
					);
					if (name === 'sw.js') response.setHeader('service-worker-allowed', '/');
					response.end(contents);
				} catch {
					next();
				}
			});
		},
		async generateBundle() {
			// Both the client and server builds run this hook; only the client one is served
			if (this.environment.name !== 'client') return;

			for (const name of await readdir(sourceDirectory)) {
				this.emitFile({
					type: 'asset',
					fileName: servedName(name),
					source: await readFile(path.join(sourceDirectory, name))
				});
			}
		}
	};
}

// The dev and preview servers need the same cross-origin isolation that server.js gives
// production, and it has to cover Vivari's worker scripts, not just documents. `server.headers`
// is not enough: it never reaches the static and public-dir middlewares, so /assets/*, /sw.js
// and /vendor/* come back bare and the kernel worker is blocked. A middleware registered from
// configureServer runs ahead of all of Vite's own, so this covers every response
function crossOriginIsolation(): Plugin {
	const isolate: Connect.NextHandleFunction = (_request, response, next) => {
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
		next();
	};

	return {
		name: 'cross-origin-isolation',
		configureServer: (server) => void server.middlewares.use(isolate),
		configurePreviewServer: (server) => void server.middlewares.use(isolate)
	};
}

export default defineConfig({
	plugins: [
		crossOriginIsolation(),
		resourceFiles(),
		vivariAssets(),
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
