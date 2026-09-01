// Generates static/vendor/*-pack.bin, the real package managers that Vivari's kernel loads
// into the VM (it fetches `${origin}/vendor/<name>-pack.bin`). Without the npm one there is
// no npm to run inside a resource, so `npm install` never completes and instance groups
// never come up.
//
// The asset cannot simply be downloaded: it is not published to npm, and it is gitignored
// in Vivari's own repo as a build artifact. Vivari generates it with scripts/vendor-npm.mjs
// and tags releases as v<version>, so this clones the tag matching the *installed*
// @vivari/core and runs their generator. Deriving the tag from the installed SDK is the
// point: a Vivari upgrade regenerates a matching pack instead of leaving a stale one that
// only shows up as npm misbehaving inside the VM.
//
// Requires git, network and a host npm. Idempotent - a no-op unless the installed Vivari
// version changed or --force is passed.
//
// Usage: node scripts/vendor-assets.mjs [--force]

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'https://github.com/maitrungduc1410/vivari.git';
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const OUTPUT_DIRECTORY = path.join(ROOT, 'static', 'vendor');
const METADATA_FILE = path.join(OUTPUT_DIRECTORY, 'meta.json');

// Which of Vivari's vendor-*.mjs generators to run
const PACKS = ['npm'];

const packFile = (pack) => path.join(OUTPUT_DIRECTORY, `${pack}-pack.bin`);

const force = process.argv.includes('--force');
const log = (message) => process.stderr.write(`[vendor-assets] ${message}\n`);

function fail(message) {
	log(message);
	process.exit(1);
}

function installedVivariVersion() {
	const manifest = path.join(ROOT, 'node_modules', '@vivari', 'core', 'package.json');
	if (!fs.existsSync(manifest)) fail('@vivari/core is not installed - run npm install first');
	return JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
}

// A pack is [uint32LE headerLength][header JSON][file bytes], gzipped. Reading the version
// back out of the artifact is better than trusting what we asked for
function packedVersion(file) {
	const raw = zlib.gunzipSync(fs.readFileSync(file));
	const headerLength = raw.readUInt32LE(0);
	return JSON.parse(raw.subarray(4, 4 + headerLength).toString('utf8')).version;
}

const vivariVersion = installedVivariVersion();
const tag = `v${vivariVersion}`;

// A newly added entry in PACKS has no file yet, so this also regenerates when that changes
if (
	!force &&
	fs.existsSync(METADATA_FILE) &&
	PACKS.every((pack) => fs.existsSync(packFile(pack)))
) {
	const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
	if (metadata.vivariVersion === vivariVersion) {
		log(`up to date - vivari ${tag}, packs: ${PACKS.join(', ')} (--force to rebuild)`);
		process.exit(0);
	}
	log(`vivari changed: ${metadata.vivariVersion} -> ${vivariVersion}, regenerating`);
}

const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'vivari-vendor-'));
try {
	log(`cloning ${tag} (scripts only)`);
	const clone = ['clone', `--branch=${tag}`, '--depth=1', '--filter=blob:none', '--sparse'];
	try {
		execFileSync('git', [...clone, REPOSITORY, checkout], { stdio: 'ignore' });
	} catch (error) {
		// Vivari tags releases as v<version>, so a missing tag is the usual cause after ENOENT
		if (error.code === 'ENOENT') fail('git is required to generate the vendor assets');
		fail(`could not clone ${REPOSITORY} at ${tag} - is there a ${tag} tag?`);
	}
	execFileSync('git', ['-C', checkout, 'sparse-checkout', 'set', 'scripts'], { stdio: 'ignore' });

	fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

	const packs = {};
	for (const pack of PACKS) {
		log(`running vivari scripts/vendor-${pack}.mjs (needs network + host npm)`);
		const script = `scripts/vendor-${pack}.mjs`;
		execFileSync(process.execPath, [script], { cwd: checkout, stdio: 'inherit' });

		const generated = path.join(
			checkout,
			'packages',
			'studio',
			'public',
			'vendor',
			`${pack}-pack.bin`
		);
		if (!fs.existsSync(generated)) fail(`${script} did not produce ${pack}-pack.bin`);
		fs.copyFileSync(generated, packFile(pack));

		const bytes = fs.readFileSync(packFile(pack));
		packs[pack] = {
			version: packedVersion(packFile(pack)),
			sha256: createHash('sha256').update(bytes).digest('hex')
		};
		log(
			`wrote ${pack}-pack.bin - ${(bytes.length / 1e6).toFixed(2)} MB, ${pack}@${packs[pack].version}`
		);
	}

	fs.writeFileSync(METADATA_FILE, `${JSON.stringify({ vivariVersion, tag, packs }, null, 2)}\n`);
} finally {
	fs.rmSync(checkout, { recursive: true, force: true });
}
