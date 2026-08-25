<script lang="ts">
	import type { Node } from '@xyflow/svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import PreviewFrame from '$lib/components/PreviewFrame.svelte';

	const { node }: { node: Node } = $props();
	const orchestrator = getOrchestrator();

	const previewUrl = $derived(orchestrator.getPreviewUrl(node.id));
</script>

<PreviewFrame {previewUrl} />
