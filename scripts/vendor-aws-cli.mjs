// Bundles resources/aws-cli with its SDK clients into static/vendor/aws-cli/aws.js, which
// src/lib/aws-cli.ts installs as /bin/aws. Served from this origin rather than npm-installed
// in the VM: a self-hosted instance may have no registry, and VM node_modules do not survive
// a reload. No network needed and ~200 ms, so it rebuilds every time.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const ENTRY = path.join(ROOT, 'resources', 'aws-cli', 'main.js');
const OUTPUT_DIRECTORY = path.join(ROOT, 'static', 'vendor', 'aws-cli');
const BUNDLE_FILE = path.join(OUTPUT_DIRECTORY, 'aws.js');

const log = (message) => process.stderr.write(`[vendor-aws-cli] ${message}\n`);

fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

// codeSplitting off: the SDK's dynamic imports would otherwise become sibling chunks
await build({
	input: ENTRY,
	platform: 'node',
	output: {
		file: BUNDLE_FILE,
		format: 'esm',
		minify: true,
		codeSplitting: false,
		banner: '#!/usr/bin/env node'
	},
	write: true
});
log(`wrote aws.js - ${(fs.statSync(BUNDLE_FILE).size / 1e6).toFixed(2)} MB`);
