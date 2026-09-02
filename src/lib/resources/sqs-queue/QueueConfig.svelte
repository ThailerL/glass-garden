<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import ConfigField from '$lib/components/ConfigField.svelte';
	import AccessSummary from '$lib/components/AccessSummary.svelte';
	import ReadOnlyValue from '$lib/components/ReadOnlyValue.svelte';
	import { queueUrlFor } from '$lib/aws-region';
	import type { Config } from './index';

	const { form, nodeId }: { form: SuperForm<Config>; nodeId: string } = $props();
	const { form: formData } = $derived(form);
</script>

<ConfigField {form} name="name" label="Name" bind:value={$formData.name} />

<ConfigField {form} name="queueName" label="Queue Name" readonly bind:value={$formData.queueName} />

<ReadOnlyValue
	label="Queue URL"
	value={queueUrlFor($formData.queueName)}
	description="What your code passes to the AWS SDK."
/>

<ConfigField
	{form}
	name="visibilityTimeout"
	label="Visibility Timeout (seconds)"
	type="number"
	description="How long a received message stays hidden from other readers before it returns to the queue."
	bind:value={$formData.visibilityTimeout}
/>

<AccessSummary {nodeId} noun="queue" verb="send and receive messages" />
