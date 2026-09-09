<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { onTabLockFree } from '$lib/tab-lock';

	// Reloaded rather than resumed: the other tab has been working since this page loaded
	onTabLockFree(() => location.reload());
</script>

<div class="flex h-dvh items-center justify-center p-6">
	<div class="flex max-w-sm flex-col items-center gap-3 text-center">
		<CopyIcon class="size-8 text-muted-foreground" />
		<h1 class="text-lg font-semibold">Glass Garden is open in another tab</h1>
		<p class="text-sm text-muted-foreground">
			Your servers, files and the local AWS region all run inside the browser, and one browser can
			only run one of them. Close the other tab and this one picks the project up where it left off.
		</p>
	</div>
</div>
