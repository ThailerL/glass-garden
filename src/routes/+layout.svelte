<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<Toaster />

{@render children?.()}
<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<ModeWatcher />
