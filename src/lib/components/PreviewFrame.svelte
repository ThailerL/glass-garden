<script lang="ts">
	const { previewUrl }: { previewUrl: string | undefined } = $props();

	let iframe: HTMLIFrameElement | undefined = $state();

	// The preview is served from its own origin, so contentWindow.location.reload() would throw
	export function reload() {
		if (iframe) iframe.src = iframe.src;
	}
</script>

{#if previewUrl}
	<iframe bind:this={iframe} title="Preview" src={previewUrl} class="h-full w-full"></iframe>
{:else}
	<div class="flex h-full items-center justify-center text-muted-foreground">
		Waiting for server…
	</div>
{/if}
