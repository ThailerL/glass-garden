<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import ConfigField from '$lib/components/ConfigField.svelte';
	import ConfigRadioField from '$lib/components/ConfigRadioField.svelte';
	import ReadOnlyValue from '$lib/components/ReadOnlyValue.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { nodeName } from '$lib/graph-state.svelte';
	import { providing } from '$lib/resources';
	import { targetPort, type Config } from './index';

	const { form, nodeId }: { form: SuperForm<Config>; nodeId: string } = $props();
	const { form: formData } = $derived(form);

	const orchestrator = getOrchestrator();
	const targets = $derived(orchestrator.getTargets(nodeId));
	// What the edge points at, whether or not it is up; the port only exists while it is
	const targetNode = $derived(providing(targets, 'http')[0]?.node);
	const port = $derived(targetPort(targets));

	const methods: Record<Config['method'], string> = {
		GET: 'GET',
		POST: 'POST',
		PUT: 'PUT',
		DELETE: 'DELETE'
	};
</script>

<ConfigField {form} name="name" label="Name" bind:value={$formData.name} />
<ConfigRadioField
	{form}
	name="method"
	label="Method"
	options={methods}
	bind:value={$formData.method}
/>
<ConfigField {form} name="path" label="Path" bind:value={$formData.path} />
<ConfigField
	{form}
	name="body"
	label="Body"
	description="Sent with every request. JSON goes as application/json, anything else as text/plain."
	bind:value={$formData.body}
/>
<ConfigField
	{form}
	name="requestsPerSecond"
	label="Requests per second"
	type="number"
	description="Spread evenly over each second."
	bind:value={$formData.requestsPerSecond}
/>
<ConfigField
	{form}
	name="maxInFlight"
	label="Max in flight"
	type="number"
	description="Requests awaiting a response at once. Past this a request is skipped and counted rather than queued, so a target that cannot keep up shows as skipped requests."
	bind:value={$formData.maxInFlight}
/>

<ReadOnlyValue
	label="Target"
	value={targetNode &&
		`${nodeName(targetNode)} ${port === null ? '(not running)' : `on localhost:${port}`}`}
	description="Requests go to the first running instance of what this generator points at, so the port changes as instances come and go."
	empty="Nothing is wired to this generator. Draw an edge to something that serves HTTP."
/>
