/// <reference types="vitest/config" />
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
const TEMPLATES_DIRECTORY = 'templates';

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

const camelCase = (name: string) =>
	name.replace(/-(.)/g, (_, character) => character.toUpperCase());

async function subdirectories(directory: string) {
	const entries = await readdir(directory, { withFileTypes: true });
	return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

// A template's directory holds one subdirectory per file set it starts a node on, keyed by
// the path to it
async function readTemplates(directory: string) {
	const sets: Record<string, FileSystemTree> = {};
	for (const template of await subdirectories(directory)) {
		for (const set of await subdirectories(path.join(directory, template))) {
			sets[`${template}/${set}`] = await readTree(path.join(directory, template, set));
		}
	}
	return sets;
}

// Exports one file tree per directory under resources/, named after it in camel case so the
// keys line up with ResourceType. templates/ is the exception: one entry per file set a
// template starts a node on, keyed by its path. Keeps the resource sources plain files
// rather than escaped template literals
function resourceFiles(): Plugin {
	return {
		name: 'resource-files',
		resolveId(id) {
			if (id === RESOURCE_FILES_MODULE) return RESOLVED_RESOURCE_FILES_MODULE;
		},
		async load(id) {
			if (id !== RESOLVED_RESOURCE_FILES_MODULE) return;

			const names = await subdirectories(SOURCE_DIRECTORY);
			const exports = await Promise.all(
				names.map(async (name) => {
					const directory = path.join(SOURCE_DIRECTORY, name);
					const value =
						name === TEMPLATES_DIRECTORY
							? await readTemplates(directory)
							: await readTree(directory);
					return `export const ${camelCase(name)} = ${JSON.stringify(value)};`;
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
	],

	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
