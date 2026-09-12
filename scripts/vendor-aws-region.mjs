// Generates static/vendor/aws-region/: pocket-region's emulator wheels and Python stdlib,
// the pinned Pyodide runtime, and pocket-region's own code bundled to reach that runtime by
// relative path. The region copies this tree into the VM, where there is no npm and no
// registry to reach.
//
// Everything is copied out of node_modules, so the pins are the lockfile's: bumping the
// emulator means bumping pocket-region. That is a deliberate release act, because ministack
// stamps a format version on each service's state file and starts that service empty when
// the stamps disagree, so a bump can cost user data.
//
// No network. Idempotent in content - the meta.json it writes is byte-stable, and that file
// is what tells a running container its copy is stale.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

// Pyodide's own python_stdlib.zip is absent on purpose: pocket-region ships one carrying
// bytecode and passes it as stdLibURL, which replaces the runtime's copy entirely
const RUNTIME_FILES = [
	'package.json',
	'pyodide.mjs',
	'pyodide.asm.mjs',
	'pyodide.asm.wasm',
	'pyodide-lock.json'
];

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const MODULES = path.join(ROOT, 'node_modules');
const POCKET_REGION = path.join(MODULES, 'pocket-region');
const PYODIDE = path.join(MODULES, 'pyodide');
const OUTPUT_DIRECTORY = path.join(ROOT, 'static', 'vendor', 'aws-region');

const log = (message) => process.stderr.write(`[vendor-aws-region] ${message}\n`);

function fail(message) {
	log(message);
	process.exit(1);
}

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

if (!fs.existsSync(POCKET_REGION)) fail('pocket-region is not installed - run npm install');
const manifest = read(path.join(POCKET_REGION, 'vendor', 'meta.json'));
const pocketRegionVersion = read(path.join(POCKET_REGION, 'package.json')).version;
const pyodideVersion = read(path.join(PYODIDE, 'package.json')).version;
// pocket-region builds its wheels against one Pyodide, and a wasm ABI mismatch shows up as
// a failure deep inside the boot. npm could satisfy its dependency with a newer one
if (pyodideVersion !== manifest.pyodideVersion) {
	fail(
		`pocket-region ${pocketRegionVersion} was built against pyodide ${manifest.pyodideVersion},` +
			` but ${pyodideVersion} is installed`
	);
}

fs.rmSync(OUTPUT_DIRECTORY, { recursive: true, force: true });
fs.mkdirSync(path.join(OUTPUT_DIRECTORY, 'pyodide'), { recursive: true });

// Every relative path and size in the tree, so the page can copy it into the VM without
// directory listings and the region can verify the copy
const files = [];

function copy(from, to) {
	const stats = fs.statSync(from, { throwIfNoEntry: false });
	if (!stats) fail(`missing: ${from}`);
	fs.copyFileSync(from, path.join(OUTPUT_DIRECTORY, to));
	files.push({ path: to, bytes: stats.size });
}

// Flat, beside meta.json: pocket-region resolves its wheels and stdlib against the one
// directory it is handed
for (const wheel of manifest.wheels) copy(path.join(POCKET_REGION, 'vendor', wheel), wheel);
copy(path.join(POCKET_REGION, 'vendor', manifest.stdlib), manifest.stdlib);
for (const file of RUNTIME_FILES) copy(path.join(PYODIDE, file), `pyodide/${file}`);

// The VM has no node_modules, so pocket-region is bundled to sit beside the runtime it
// loads. Its bare `pyodide` import becomes the relative path that runtime is copied to
const BUNDLE = 'pocket-region.js';
await build({
	input: path.join(POCKET_REGION, 'dist', 'node.js'),
	platform: 'node',
	plugins: [
		{
			name: 'pyodide-from-the-cache',
			resolveId(id) {
				if (id === 'pyodide') return { id: './pyodide/pyodide.mjs', external: true };
			}
		}
	],
	output: {
		file: path.join(OUTPUT_DIRECTORY, BUNDLE),
		format: 'esm',
		codeSplitting: false
	},
	write: true
});
files.push({ path: BUNDLE, bytes: fs.statSync(path.join(OUTPUT_DIRECTORY, BUNDLE)).size });

const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
const megabytes = Number((totalBytes / 1e6).toFixed(1));
fs.writeFileSync(
	path.join(OUTPUT_DIRECTORY, 'meta.json'),
	`${JSON.stringify(
		{
			...manifest,
			pocketRegionVersion,
			files: files.sort((a, b) => a.path.localeCompare(b.path))
		},
		null,
		2
	)}\n`
);
log(
	`wrote ${manifest.wheels.length} wheels + runtime - ${megabytes} MB,` +
		` pocket-region ${pocketRegionVersion} (${manifest.emulatorSpec})`
);
