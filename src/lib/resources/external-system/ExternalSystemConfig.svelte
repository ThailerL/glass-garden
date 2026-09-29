<script lang="ts">
	import ReadOnlyValue from '$lib/components/ReadOnlyValue.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';

	const { nodeId }: { nodeId: string } = $props();

	const orchestrator = getOrchestrator();
	// The reservation rather than a live instance, so the address shows before it has started
	const port = $derived(orchestrator.getReservedPorts(nodeId)[0]);
</script>

<p class="text-sm text-muted-foreground">
	Run by someone outside your system. You can call it and read what it reports, but its code and its
	starting and stopping are not yours.
</p>

<ReadOnlyValue
	label="Address"
	value={port === undefined ? undefined : `http://localhost:${port}`}
	description="Each node connected to it is handed an address of its own under this one, in its environment."
	empty="Available once it has started."
/>
