/** @type {import("prettier").Config} */
const config = {
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 100,
	// Tailwind's plugin sorts classes and has to run last
	plugins: ['prettier-plugin-svelte', 'prettier-plugin-astro', 'prettier-plugin-tailwindcss'],
	overrides: [
		{ files: '*.svelte', options: { parser: 'svelte' } },
		{ files: '*.astro', options: { parser: 'astro' } },
		// Its stylesheet adds tokens the app's does not, so classes sort against that one
		{ files: 'site/**', options: { tailwindStylesheet: './site/src/styles/global.css' } }
	],
	tailwindStylesheet: './src/routes/layout.css'
};

export default config;
