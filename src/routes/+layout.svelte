<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';

	let { children } = $props();
</script>

{@render children?.()}
<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<ModeWatcher />
