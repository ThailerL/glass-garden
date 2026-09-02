<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import { Label } from '$lib/components/ui/label';
	import ConfigField from '$lib/components/ConfigField.svelte';
	import { nodeName } from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import type { Config } from './index';

	const { form, nodeId }: { form: SuperForm<Config>; nodeId: string } = $props();
	const { form: formData } = $derived(form);

	const orchestrator = getOrchestrator();
	// A bucket is pointed at, not pointing: what uses it are the edges that end here
	const consumers = $derived(orchestrator.getDependents(nodeId));
</script>

<ConfigField {form} name="name" label="Name" bind:value={$formData.name} />

<ConfigField
	{form}
	name="bucketName"
	label="Bucket Name"
	description="The name your code passes to the AWS SDK. Follows S3's naming rules."
	bind:value={$formData.bucketName}
/>

<div class="space-y-2">
	<Label>Access</Label>
	<p class="text-sm text-muted-foreground">
		{#if consumers.length > 0}
			{consumers.map(({ node }) => nodeName(node)).join(', ')}
			{consumers.length === 1 ? 'has' : 'have'}
			<code class="font-mono text-xs">AWS_ENDPOINT_URL</code> and credentials for this bucket, and may
			read and write it only.
		{:else}
			Nothing is connected yet. Draw an edge from anything that runs code to this bucket to let it
			read and write.
		{/if}
	</p>
</div>
