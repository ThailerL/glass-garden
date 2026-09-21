<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import ConfigField from '$lib/components/ConfigField.svelte';
	import ReadOnlyValue from '$lib/components/ReadOnlyValue.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { connectionUrl } from './connection';
	import type { Config } from './index';

	const { form, nodeId }: { form: SuperForm<Config>; nodeId: string } = $props();
	const { form: formData } = $derived(form);

	const orchestrator = getOrchestrator();
	// The reservation rather than a live instance, so the address still shows while stopped
	const port = $derived(orchestrator.getReservedPorts(nodeId)[0]);
	const url = $derived(port === undefined ? undefined : connectionUrl(port));
</script>

<ConfigField {form} name="name" label="Name" bind:value={$formData.name} />

<ConfigField
	{form}
	name="maxConnections"
	label="Max Connections"
	type="number"
	description="Connections past this limit are refused."
	bind:value={$formData.maxConnections}
/>

<ReadOnlyValue
	label="Connection String"
	value={url}
	empty="Available once the database has started."
/>
