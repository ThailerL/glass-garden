<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import { Label } from '$lib/components/ui/label';
	import ReadOnlyValue from '$lib/components/ReadOnlyValue.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import type { Config, Exchange } from './index';

	const { form, nodeId }: { form: SuperForm<Config>; nodeId: string } = $props();
	const { form: formData } = $derived(form);

	const orchestrator = getOrchestrator();
	// The reservation rather than a live instance, so the address shows before it has started
	const port = $derived(orchestrator.getReservedPorts(nodeId)[0]);

	const SENDER: Record<Exchange['direction'], string> = {
		'you send': 'You send',
		'it sends': 'It sends'
	};
</script>

<p class="text-sm text-muted-foreground">
	Run by someone outside your system. You can exchange requests with it and read what it reports,
	but its code and its starting and stopping are not yours.
</p>

<ReadOnlyValue
	label="Address"
	value={port === undefined ? undefined : `http://localhost:${port}`}
	description="Each node connected to it is handed an address of its own under this one, in its environment."
	empty="Available once it has started."
/>

{#each $formData.docs.exchanges as exchange, index (index)}
	<div class="space-y-2">
		<ReadOnlyValue label={SENDER[exchange.direction]} value={exchange.signature} />
		{#each exchange.details as detail, line (line)}
			<p class="text-sm text-muted-foreground">{detail}</p>
		{/each}
	</div>
{/each}

{#if $formData.docs.notes.length > 0}
	<div class="space-y-2">
		<Label>Notes</Label>
		{#each $formData.docs.notes as note, index (index)}
			<p class="text-sm text-muted-foreground">{note}</p>
		{/each}
	</div>
{/if}
