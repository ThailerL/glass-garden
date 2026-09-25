// Astro empties its outDir, so the site builds into site/dist and is copied here beside the app
import fs from 'node:fs';

// Every other name in static/ is the content site's
const APP = new Set([
	'data',
	'vendor',
	'favicon.svg',
	'favicon-32.png',
	'apple-touch-icon.png',
	'og.png'
]);

const from = new URL('../site/dist/', import.meta.url);
const to = new URL('../static/', import.meta.url);

const site = fs.readdirSync(from);
const problems = [
	...site
		.filter((name) => APP.has(name))
		.map((name) => `site/dist/${name} would overwrite the app's static/${name}`),
	...fs
		.readdirSync(to)
		.filter((name) => !APP.has(name) && !site.includes(name))
		.map((name) => `static/${name} is neither the app's nor built by the site`)
];

if (problems.length > 0) {
	process.stderr.write(
		'[copy-site] static/ would mix the app and the content site:\n' +
			problems.map((problem) => `  ${problem}\n`).join('') +
			'Delete a stale page folder, or add a new app file to the list in this script.\n'
	);
	process.exit(1);
}

for (const name of site) {
	fs.rmSync(new URL(name, to), { recursive: true, force: true });
	fs.cpSync(new URL(name, from), new URL(name, to), { recursive: true });
}
