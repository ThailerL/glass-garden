<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
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
			disabled={!previewUrl}
			onclick={() => {
				frame?.reload();
				tour.noteRefresh(nodeId);
			}}
		>
			<RefreshCwIcon />
		</Button>
		<InstanceSelect {nodeId} bind:selected />
	</div>
	<div class="min-h-0 flex-1">
		<PreviewFrame bind:this={frame} {previewUrl} />
	</div>
</div>
