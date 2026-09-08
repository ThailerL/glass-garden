// Bundles resources/postgres/server.js with PGlite into static/vendor/postgres/, which the
// postgres resource copies into the VM. Served from this origin rather than npm-installed in
// the node's directory: a self-hosted instance may have no registry, and VM node_modules do
// not survive a reload, so that install is paid every session - 409 files and 27 MB from the
// registry for what is really a bundle plus two WASM assets.
//
// PGlite locates its assets with `new URL('./pglite.wasm', import.meta.url)`, so they are
// copied next to the bundle and must stay siblings of it inside the VM.
//
// No network needed - pglite is a devDependency, pinned by our lockfile.
//
// Usage: node scripts/vendor-postgres.mjs

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const ENTRY = path.join(ROOT, 'resources', 'postgres', 'server.js');
const OUTPUT_DIRECTORY = path.join(ROOT, 'static', 'vendor', 'postgres');
const BUNDLE = 'server.js';

// initdb runs only for a node's first cluster, but there is no first start without it
const ASSETS = ['pglite.wasm', 'pglite.data', 'initdb.wasm', 'initdb.js'];

const log = (message) => process.stderr.write(`[vendor-postgres] ${message}\n`);

// Resolved through the package's exports rather than guessed at, so a hoisted or
// deduplicated install still finds the assets next to the entry point
let distDirectory;
try {
	distDirectory = path.dirname(fileURLToPath(import.meta.resolve('@electric-sql/pglite')));
} catch {
	log('@electric-sql/pglite is not installed - run npm install first');
	process.exit(1);
}

fs.rmSync(OUTPUT_DIRECTORY, { recursive: true, force: true });
fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

// codeSplitting off: PGlite's dynamic imports would otherwise become sibling chunks
await build({
	input: ENTRY,
	platform: 'node',
	output: {
		file: path.join(OUTPUT_DIRECTORY, BUNDLE),
		format: 'esm',
		minify: true,
		codeSplitting: false
	},
	write: true
});

// Every file and its hash, so the page can copy the tree into the VM without directory
// listings and can tell a stale or truncated copy from a complete one
const files = [];
const record = (file) => {
	const bytes = fs.readFileSync(path.join(OUTPUT_DIRECTORY, file));
	files.push({
		path: file,
		bytes: bytes.length,
		sha256: createHash('sha256').update(bytes).digest('hex')
	});
};
record(BUNDLE);

for (const asset of ASSETS) {
	const source = path.join(distDirectory, asset);
	if (!fs.existsSync(source)) {
		log(`pglite no longer ships ${asset} - check what replaced it before shipping this`);
		process.exit(1);
	}
	fs.copyFileSync(source, path.join(OUTPUT_DIRECTORY, asset));
	record(asset);
}

const { version } = JSON.parse(
	fs.readFileSync(path.join(distDirectory, '..', 'package.json'), 'utf8')
);
fs.writeFileSync(
	path.join(OUTPUT_DIRECTORY, 'meta.json'),
	JSON.stringify({ pgliteVersion: version, files }, null, 2) + '\n'
);

const total = files.reduce((sum, file) => sum + file.bytes, 0);
log(`wrote pglite ${version} - ${files.length} files, ${(total / 1e6).toFixed(1)} MB`);
