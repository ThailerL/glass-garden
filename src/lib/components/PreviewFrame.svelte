<script lang="ts">
	const { previewUrl }: { previewUrl: string | undefined } = $props();
</script>

{#if previewUrl}
	<iframe title="Preview" src={previewUrl} class="h-full w-full"></iframe>
{:else}
	<div class="flex h-full items-center justify-center text-muted-foreground">
		Waiting for server…
	</div>
{/if}
