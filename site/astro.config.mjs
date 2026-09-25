import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// Absolute URLs are written only when PUBLIC_ORIGIN was given at build time
export default defineConfig({
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
