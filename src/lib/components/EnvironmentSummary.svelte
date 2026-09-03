<script lang="ts">
	// What a node's code will find in its environment, from its own connections. Read only:
	// every line here is decided by the canvas, not by the form
	import ReadOnlyValue from '$lib/components/ReadOnlyValue.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { consumerEnv, withheldConventionalNames } from '$lib/resources/env';

	const { nodeId }: { nodeId: string } = $props();

	const graphState = getGraphState();
	const orchestrator = getOrchestrator();

	const node = $derived(graphState.getNode(nodeId));
	const env = $derived(node ? consumerEnv(node, orchestrator.getNeighbours(nodeId)) : {});
	// Left in the order it was built: credentials, then a line per connected resource, then
	// the conventional names
	const lines = $derived(Object.entries(env));
	// Named so a variable the user expected never just vanishes from this list
	const withheld = $derived(withheldConventionalNames(orchestrator.getNeighbours(nodeId)));
</script>

<ReadOnlyValue
	label="Environment"
	description="Set by what this node is connected to. When only one of a resource type is connected, its value is also set under the name most code expects, such as DATABASE_URL."
>
	{#each lines as [name, value] (name)}
		<span class="block">{name}={value}</span>
	{/each}
	<span class="block">
		PORT=<span class="text-muted-foreground">&lt;assigned by Glass Garden&gt;</span></span
	>
	{#each withheld as name (name)}
		<span class="block">
			{name}=<span class="text-muted-foreground">&lt;not set: more than one connected&gt; </span>
		</span>
	{/each}
</ReadOnlyValue>
