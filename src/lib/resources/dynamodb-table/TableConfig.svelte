<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import ConfigField from '$lib/components/ConfigField.svelte';
	import AccessSummary from '$lib/components/AccessSummary.svelte';
	import type { Config } from './index';

	const { form, nodeId }: { form: SuperForm<Config>; nodeId: string } = $props();
	const { form: formData } = $derived(form);
</script>

<ConfigField {form} name="name" label="Name" bind:value={$formData.name} />

<ConfigField
	{form}
	name="tableName"
	label="Table Name"
	readonly
	description="The name your code passes to the AWS SDK."
	bind:value={$formData.tableName}
/>

<ConfigField
	{form}
	name="partitionKey"
	label="Partition Key"
	readonly
	description="The string attribute every item is found by."
	bind:value={$formData.partitionKey}
/>

<AccessSummary {nodeId} noun="table" verb="read and write items" />
