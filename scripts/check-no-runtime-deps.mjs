// The production image copies build/ and server.js and nothing else, so it has no
// node_modules at runtime. That works because every package is a devDependency and
// adapter-node inlines whatever the server imports into build/server. A `dependencies`
// entry breaks that at container start rather than here, so fail here instead.

import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const runtime = Object.keys(manifest.dependencies ?? {});

if (runtime.length > 0) {
	process.stderr.write(
		`[check-no-runtime-deps] package.json declares runtime dependencies: ${runtime.join(', ')}\n` +
			'The Dockerfile ships no node_modules, so the image would fail to start. Either move\n' +
			'these to devDependencies if the bundler can inline them, or install them in the\n' +
			"image's final stage and drop this check.\n"
	);
	process.exit(1);
}
