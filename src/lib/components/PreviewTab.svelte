<script lang="ts">
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import PreviewFrame from '$lib/components/PreviewFrame.svelte';
	import InstanceSelect from '$lib/components/InstanceSelect.svelte';
	import { tour } from '$lib/tour.svelte';

	const { nodeId }: { nodeId: string } = $props();
	const orchestrator = getOrchestrator();

	let frame: { reload: () => void } | undefined = $state();

	// Settled by the select, which resolves nothing chosen yet to the node's first instance
	let selected = $state<number>();

	// Nothing to show until something is listening on the port
	const previewUrl = $derived(
		orchestrator.getInstances(nodeId).find(({ port }) => port === selected)?.previewUrl
	);
</script>

<div class="flex h-full flex-col gap-2" data-tour="preview-panel">
	<div class="flex items-center gap-2">
		<Button
			variant="outline"
			size="icon"
			data-tour="refresh"
			aria-label="Reload the preview"
			disabled={!previewUrl}
			onclick={() => {
				frame?.reload();
				tour.noteRefresh(nodeId);
			}}
		>
			<RefreshCwIcon />
		</Button>
		{#if previewUrl}
			<!-- Served by the preview service worker rather than by SvelteKit routing, so there
			     is no route for resolve() to take, and Button's href only takes resolved ones -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				href={previewUrl}
				target="_blank"
				rel="noreferrer"
				aria-label="Open preview in a new tab"
				title="Open preview in a new tab"
				class={buttonVariants({ variant: 'outline', size: 'icon' })}
			>
				<ExternalLinkIcon />
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{:else}
			<!-- An anchor has no disabled state to style, so nothing to open is a real button
			     and dims like the refresh beside it -->
			<Button variant="outline" size="icon" aria-label="Open preview in a new tab" disabled>
				<ExternalLinkIcon />
			</Button>
		{/if}
		<InstanceSelect {nodeId} bind:selected />
	</div>
	<div class="min-h-0 flex-1">
		<PreviewFrame bind:this={frame} {previewUrl} />
	</div>
</div>
