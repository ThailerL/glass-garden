<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import favicon from '$lib/assets/favicon.svg';
	import { setGraphState } from '$lib/graph-state.svelte';
	import { setFileState } from '$lib/file-state.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	const fileState = setFileState(data.db);
	setGraphState(fileState);
</script>

<Toaster />
<ModeWatcher />

{@render children?.()}
<svelte:head>
	<link rel="icon" href={favicon} />
	<title>InfraLab</title>
</svelte:head>
