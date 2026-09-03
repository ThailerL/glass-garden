<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import ConfigField from '$lib/components/ConfigField.svelte';
	import EnvironmentSummary from '$lib/components/EnvironmentSummary.svelte';
	import ReadOnlyValue from '$lib/components/ReadOnlyValue.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { nodeName } from '$lib/graph-state.svelte';
	import type { Config } from './index';

	const { form, nodeId }: { form: SuperForm<Config>; nodeId: string } = $props();
	const { form: formData } = $derived(form);

	const orchestrator = getOrchestrator();
	// What invokes this function: the edges that end here
	const triggers = $derived(orchestrator.getSources(nodeId).map(({ node }) => node));
</script>

<ConfigField {form} name="name" label="Name" bind:value={$formData.name} />
<ConfigField
	{form}
	name="timeout"
	label="Timeout (seconds)"
	type="number"
	description="An invocation running longer than this fails, and its execution environment is replaced."
	bind:value={$formData.timeout}
/>
<ConfigField
	{form}
	name="maxConcurrency"
	label="Max Concurrency"
	type="number"
	description="How many execution environments may run at once. Past this, a synchronous request or batch is refused rather than queued, as Lambda refuses one it has no concurrency for."
	bind:value={$formData.maxConcurrency}
/>

<ReadOnlyValue
	label="Triggers"
	description="A queue delivers up to ten messages per invocation as event.Records, and redelivers the batch if the handler throws. A load balancer or the Preview tab sends one HTTP request per invocation."
	empty="No triggers configured. Draw an edge from a queue or a load balancer to this function."
	listEmpty={triggers.length === 0}
>
	{#each triggers as node (node.id)}
		<span class="block">{nodeName(node)}</span>
	{/each}
</ReadOnlyValue>

<EnvironmentSummary {nodeId} />
