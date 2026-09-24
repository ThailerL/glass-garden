import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// Builds into the app's static/ folder, so one Worker and one image serve these at /about.
// Canonicals stay relative and the app's own sitemap lists these pages, since a build that was
// given no PUBLIC_ORIGIN still has to serve. The parts that cannot be relative, link cards and
// breadcrumb items, are written only when that address was given at build time
export default defineConfig({
	base: '/about',
	outDir: '../static/about',
	// One form, so a canonical cannot disagree with the URL that served it
	trailingSlash: 'never',
	vite: {
		plugins: [tailwindcss()],
		// One cached file beats inlining the icon into every page twice
		build: { assetsInlineLimit: 0 },
		// The theme layer lives with the app, above this project's root
		server: { fs: { allow: ['..'] } }
	}
});
