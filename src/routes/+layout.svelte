<script lang="ts">
	import './layout.css';
	import { untrack } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { Spinner } from '$lib/components/ui/spinner';
	import { embedded, openEmbeddedProject } from '$lib/embed';
	import { messageOf } from '$lib/errors';
	import AppShell from './AppShell.svelte';
	import DuplicateTabNotice from './DuplicateTabNotice.svelte';
	import NotIsolatedNotice from './NotIsolatedNotice.svelte';
	import Notice from './Notice.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	// Read once, so a rerun without the link cannot remount the shell over a running project
	const initial = untrack(() => data);

	// An iframe's navigations land in the host page's history, so the editor swaps in place
	if (embedded) document.body.setAttribute('data-sveltekit-replacestate', '');
</script>

<ModeWatcher />

{#if initial.state === 'notIsolated'}
	<NotIsolatedNotice />
{:else if initial.state === 'blocked'}
	<DuplicateTabNotice />
{:else}
	<!-- A plain id is not a promise, so only the embed's import waits here -->
	{#await initial.state === 'embed' ? openEmbeddedProject(initial.hash) : initial.projectId}
		<Notice icon={Spinner} title="Setting up" />
	{:then projectId}
		<AppShell {projectId} start={initial.state === 'embed' && initial.start}>
			{@render children?.()}
		</AppShell>
	{:catch error}
		<Notice icon={TriangleAlertIcon} title="This couldn't be opened">
			<p class="text-sm text-muted-foreground">{messageOf(error)}</p>
		</Notice>
	{/await}
{/if}

<svelte:head>
	<title>Glass Garden</title>
</svelte:head>
