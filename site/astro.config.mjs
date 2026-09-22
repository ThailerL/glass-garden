import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// Builds into the app's static/ folder, so one Worker and one image serve these at /about.
// Nothing here reads the deployment's address: only the running app knows it, so canonicals
// are relative, the app's own sitemap lists these pages, and the embed resolves its origin
// in the page
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
