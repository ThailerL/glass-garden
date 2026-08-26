<script lang="ts">
	import type { Node } from '@xyflow/svelte';
	import * as Select from '$lib/components/ui/select';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import PreviewFrame from '$lib/components/PreviewFrame.svelte';

	const { node }: { node: Node } = $props();
	const orchestrator = getOrchestrator();

	const instances = $derived(orchestrator.getInstances(node.id));
	let selected = $state(0);
	// Restarting with a lower instance count can leave the selection out of range
	const selectedIndex = $derived(selected < instances.length ? selected : 0);
	const previewUrl = $derived(instances[selectedIndex]?.previewUrl);
</script>

<div class="flex h-full flex-col gap-2">
	{#if instances.length > 1}
		<!-- Select values are strings, so the index is converted at the binding -->
		<Select.Root
			type="single"
			value={String(selectedIndex)}
			onValueChange={(value) => (selected = Number(value))}
		>
			<Select.Trigger>Instance {selectedIndex + 1}</Select.Trigger>
			<Select.Content>
				{#each instances as _, index (index)}
					<Select.Item value={String(index)}>Instance {index + 1}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}
	<div class="min-h-0 flex-1">
		<PreviewFrame {previewUrl} />
	</div>
</div>