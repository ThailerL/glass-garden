<script lang="ts">
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { buttonVariants } from '$lib/components/ui/button';
	import { mainAppUrl } from '$lib/embed';
	import Notice from './Notice.svelte';

	// For the page's author, who can fix this; the reader cannot
	console.warn(
		'Glass Garden cannot run in this frame because the page embedding it is not cross-origin isolated. ' +
			'Send these headers with the page:\n' +
			'  Cross-Origin-Opener-Policy: same-origin\n' +
			'  Cross-Origin-Embedder-Policy: credentialless\n' +
			'and give the iframe allow="cross-origin-isolated".'
	);
</script>

<Notice icon={TriangleAlertIcon} title="Glass Garden can't run on this page">
	<p class="text-sm text-muted-foreground">
		This page isn't set up to run servers inside your browser.
	</p>
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a href={mainAppUrl(location.hash)} target="_blank" rel="noreferrer" class={buttonVariants()}>
		Open in Glass Garden <ExternalLinkIcon />
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</Notice>
