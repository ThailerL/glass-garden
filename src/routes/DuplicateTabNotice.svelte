<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { embedded } from '$lib/embed';
	import { onTabLockFree } from '$lib/tab-lock';
	import Notice from './Notice.svelte';

	// Reloaded rather than resumed: the other tab has been working since this page loaded
	onTabLockFree(() => location.reload());
</script>

{#if embedded}
	<!-- The other one can be a second frame on this very page, so there is no tab to close -->
	<Notice icon={CopyIcon} title="Glass Garden is already running on this site">
		<p class="text-sm text-muted-foreground">
			Your servers, files and the local AWS region all run inside the browser, and this site can
			only run one of them at a time.
		</p>
	</Notice>
{:else}
	<Notice icon={CopyIcon} title="Glass Garden is open in another tab">
		<p class="text-sm text-muted-foreground">
			Your servers, files and the local AWS region all run inside the browser, and one browser can
			only run one of them. Close the other tab and this one picks the project up where it left off.
		</p>
	</Notice>
{/if}
