<script lang="ts">
	// What may reach a resource node. The canvas already draws the edges, so this says the
	// part it cannot show: that the connected nodes are the only ones with credentials
	import { Label } from '$lib/components/ui/label';
	import { getOrchestrator } from '$lib/orchestrator.svelte';

	let {
		nodeId,
		noun,
		verb
	}: {
		nodeId: string;
		// What this resource is called in prose - "queue", "bucket", "table"
		noun: string;
		// What a connected node may do, as a bare verb phrase: "send and receive messages"
		verb: string;
	} = $props();

	const orchestrator = getOrchestrator();
	// A resource is reached, not reaching: what uses it are the edges that end here
	const consumers = $derived(orchestrator.getDependents(nodeId));
	const count = $derived(
		consumers.length === 1 ? 'One connected node' : `${consumers.length} connected nodes`
	);
</script>

<div class="space-y-2">
	<Label>Access</Label>
	<p class="text-sm text-muted-foreground">
		{#if consumers.length > 0}
			{count} can {verb}. Nothing else can.
		{:else}
			Nothing is connected yet. Draw an edge from anything that runs code to this {noun} to let it {verb}.
		{/if}
	</p>
</div>
