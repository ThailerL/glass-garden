<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import ConfigField from '$lib/components/ConfigField.svelte';
	import { Label } from '$lib/components/ui/label';
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
	const env = $derived(node ? consumerEnv(node, orchestrator.getUpstreams(nodeId)) : {});
	const lines = $derived(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
	// Named so a variable the user expected never just vanishes from this list
	const withheld = $derived(withheldConventionalNames(orchestrator.getUpstreams(nodeId)));
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

<div class="space-y-2">
	<Label>Environment</Label>
	<!-- Not Inputs: a textbox invites editing values that are only there to be read -->
	<p class="rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs break-all select-all">
		{#each lines as [name, value] (name)}
			<span class="block">{name}={value}</span>
		{/each}
		<!-- Every other line is literally what the process receives; this one differs per
		     instance, so only the value is prose - the name is as real as the rest -->
		<span class="block"
			>PORT=<span class="text-muted-foreground">&lt;assigned by Glass Garden&gt;</span></span
		>
		{#each withheld as name (name)}
			<span class="block"
				>{name}=<span class="text-muted-foreground">&lt;not set: more than one connected&gt;</span
				></span
			>
		{/each}
	</p>
	<p class="text-sm text-muted-foreground">
		Set from what this group is connected to. Draw an edge to a resource to add its variables. A
		resource connected on its own is also set under the conventional name for its kind, so code
		written for it elsewhere works unchanged.
	</p>
</div>
