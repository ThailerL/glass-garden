<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import ConfigField from '$lib/components/ConfigField.svelte';
	import ReadOnlyValue from '$lib/components/ReadOnlyValue.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { consumerEnv, withheldConventionalNames } from '../env';
	import type { Config } from './index';

	const { form, nodeId }: { form: SuperForm<Config>; nodeId: string } = $props();
	const { form: formData } = $derived(form);

	const graphState = getGraphState();
	const orchestrator = getOrchestrator();

	// What this group's code will find in its environment, from its own connections. Read
	// only: every line here is decided by the canvas, not by the form
	const node = $derived(graphState.getNode(nodeId));
	const env = $derived(node ? consumerEnv(node, orchestrator.getNeighbours(nodeId)) : {});
	const lines = $derived(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
	// Named so a variable the user expected never just vanishes from this list
	const withheld = $derived(withheldConventionalNames(orchestrator.getNeighbours(nodeId)));
</script>

<ConfigField {form} name="name" label="Name" bind:value={$formData.name} />
<ConfigField
	{form}
	name="instanceCount"
	label="Instance Count"
	type="number"
	bind:value={$formData.instanceCount}
/>
<ConfigField {form} name="command" label="Command" bind:value={$formData.command} />

<ReadOnlyValue
	label="Environment"
	description="Set by what this group is connected to. When only one of a resopurce type is connected, its value is also set under the name most code expects, such as DATABASE_URL."
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
