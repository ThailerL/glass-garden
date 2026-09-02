// Generates static/vendor/aws-region/: the pinned Pyodide runtime plus every wheel the
// emulator needs, so the in-VM region boots entirely from this origin. The set is resolved
// by really installing it under the pinned Pyodide and freezing the environment.
//
// Bumping PYODIDE_VERSION or EMULATOR_SPEC is a deliberate release act: ministack stamps a
// format version on each service's state file and starts that service empty when the
// stamps disagree, so a bump can cost user data. Never let these pins drift.
//
// Requires network and a host npm. Idempotent - a no-op unless the pins changed or
// --force is passed.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PYODIDE_VERSION = '314.0.6';
const EMULATOR_SPEC = 'ministack==1.5.5';
const EMULATOR_NAME = EMULATOR_SPEC.split('==')[0];

const RUNTIME_FILES = [
	'package.json',
	'pyodide.mjs',
	'pyodide.asm.mjs',
	'pyodide.asm.wasm',
	'python_stdlib.zip',
	'pyodide-lock.json'
];

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const OUTPUT_DIRECTORY = path.join(ROOT, 'static', 'vendor', 'aws-region');
const METADATA_FILE = path.join(OUTPUT_DIRECTORY, 'meta.json');

const force = process.argv.includes('--force');
const log = (message) => process.stderr.write(`[vendor-aws-region] ${message}\n`);

function fail(message) {
	log(message);
	process.exit(1);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

// PEP 503: micropip and the lockfiles disagree on dashes vs underscores
function canonical(name) {
	return name.toLowerCase().replace(/[-_.]+/g, '-');
}

if (!force && fs.existsSync(METADATA_FILE)) {
	const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
	if (metadata.pyodideVersion === PYODIDE_VERSION && metadata.emulatorSpec === EMULATOR_SPEC) {
		log(`up to date - pyodide ${PYODIDE_VERSION}, ${EMULATOR_SPEC} (--force to rebuild)`);
		process.exit(0);
	}
	log(`pins changed: regenerating`);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-region-vendor-'));
try {
	log(`installing pyodide@${PYODIDE_VERSION} (needs network + host npm)`);
	try {
		execFileSync(
			'npm',
			['install', '--no-save', '--no-audit', '--no-fund', `pyodide@${PYODIDE_VERSION}`],
			{ cwd: work, stdio: ['ignore', 'ignore', 'inherit'] }
		);
	} catch {
		fail(`npm could not install pyodide@${PYODIDE_VERSION}`);
	}
	const packageDir = path.join(work, 'node_modules', 'pyodide');

	// Wheel-loading noise goes to stdout, so the child writes its result to a file instead
	const listScript = path.join(work, 'list.mjs');
	const listFile = path.join(work, 'installed.json');
	fs.writeFileSync(
		listScript,
		`import fs from 'node:fs';
import { loadPyodide } from ${JSON.stringify(pathToFileURL(path.join(packageDir, 'pyodide.mjs')).href)};
const py = await loadPyodide();
await py.loadPackage('micropip');
const result = await py.runPythonAsync(\`
import json, micropip
await micropip.install(${JSON.stringify(EMULATOR_SPEC)})
json.dumps({
    "installed": [{"name": p.name, "version": p.version, "source": p.source}
                  for p in micropip.list().values()],
    "lock": json.loads(micropip.freeze()),
})
\`);
fs.writeFileSync(${JSON.stringify(listFile)}, result);
`
	);
	log(`resolving the wheel set for ${EMULATOR_SPEC}`);
	execFileSync(process.execPath, [listScript], {
		cwd: work,
		stdio: ['ignore', 'ignore', 'inherit']
	});
	// list() names what is actually installed; freeze() knows each PyPI wheel's URL
	const { installed: packages, lock } = JSON.parse(fs.readFileSync(listFile, 'utf8'));
	const emulator = packages.find((entry) => entry.name === EMULATOR_NAME);
	if (!emulator) fail(`install did not include ${EMULATOR_NAME}`);
	const indexByName = (entries) =>
		new Map(Object.values(entries ?? {}).map((entry) => [canonical(entry.name), entry]));
	const frozenEntries = indexByName(lock.packages);

	// Distribution packages report source 'pyodide'; their wheel names and checksums come
	// from the runtime's own lockfile, and the freeze run left the wheels cached
	const distributionLock = JSON.parse(
		fs.readFileSync(path.join(packageDir, 'pyodide-lock.json'), 'utf8')
	);
	const distEntries = indexByName(distributionLock.packages);

	fs.rmSync(OUTPUT_DIRECTORY, { recursive: true, force: true });
	const wheelsDir = path.join(OUTPUT_DIRECTORY, 'wheels');
	const runtimeDir = path.join(OUTPUT_DIRECTORY, 'pyodide');
	fs.mkdirSync(wheelsDir, { recursive: true });
	fs.mkdirSync(runtimeDir, { recursive: true });

	const distPackages = [];
	const pypiWheels = [];
	const downloads = [];
	// Every relative path and size in the tree, so the page can copy it into the VM
	// without directory listings and the region can verify the copy
	const files = [];
	let totalBytes = 0;
	const writeWheel = (file, bytes) => {
		fs.writeFileSync(path.join(wheelsDir, file), bytes);
		files.push({ path: `wheels/${file}`, bytes: bytes.length });
		totalBytes += bytes.length;
	};
	for (const entry of packages) {
		if (entry.source === 'pyodide') {
			const dist = distEntries.get(canonical(entry.name));
			if (!dist) fail(`${entry.name} is not in the distribution lockfile`);
			const file = path.basename(dist.file_name);
			const cached = path.join(packageDir, file);
			if (!fs.existsSync(cached)) fail(`cached wheel missing: ${file}`);
			const bytes = fs.readFileSync(cached);
			if (dist.sha256 && sha256(bytes) !== dist.sha256) fail(`checksum mismatch: ${file}`);
			distPackages.push(entry.name);
			writeWheel(file, bytes);
		} else {
			const frozen = frozenEntries.get(canonical(entry.name));
			if (!frozen || !/^https?:/.test(frozen.file_name)) {
				fail(`no download URL for ${entry.name} (source: ${entry.source})`);
			}
			const file = decodeURIComponent(frozen.file_name.split('/').pop());
			pypiWheels.push(file);
			downloads.push(async () => {
				log(`downloading ${file}`);
				const response = await fetch(frozen.file_name);
				if (!response.ok) fail(`download failed (${response.status}): ${frozen.file_name}`);
				const bytes = Buffer.from(await response.arrayBuffer());
				if (frozen.sha256 && sha256(bytes) !== frozen.sha256) fail(`checksum mismatch: ${file}`);
				writeWheel(file, bytes);
			});
		}
	}
	await Promise.all(downloads.map((download) => download()));

	for (const file of RUNTIME_FILES) {
		const source = path.join(packageDir, file);
		const stats = fs.statSync(source, { throwIfNoEntry: false });
		if (!stats) fail(`pyodide runtime file missing: ${file}`);
		fs.copyFileSync(source, path.join(runtimeDir, file));
		files.push({ path: `pyodide/${file}`, bytes: stats.size });
		totalBytes += stats.size;
	}

	const megabytes = (totalBytes / 1e6).toFixed(1);
	fs.writeFileSync(
		METADATA_FILE,
		`${JSON.stringify(
			{
				pyodideVersion: PYODIDE_VERSION,
				emulatorSpec: EMULATOR_SPEC,
				ministackVersion: emulator.version,
				distPackages,
				pypiWheels,
				files: files.sort((a, b) => a.path.localeCompare(b.path)),
				megabytes: Number(megabytes)
			},
			null,
			2
		)}\n`
	);
	log(
		`wrote ${packages.length} wheels + runtime - ${megabytes} MB, ${EMULATOR_NAME} ${emulator.version}`
	);
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
