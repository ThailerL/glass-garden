<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import AppShell from './AppShell.svelte';
	import DuplicateTabNotice from './DuplicateTabNotice.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
</script>

<ModeWatcher />

{#if data.blocked}
	<DuplicateTabNotice />
{:else}
	<AppShell projectId={data.projectId}>
		{@render children?.()}
	</AppShell>
{/if}

<svelte:head>
	<title>Glass Garden</title>
</svelte:head>
