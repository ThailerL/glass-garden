<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import ConfigField from '$lib/components/ConfigField.svelte';
	import type { Config } from './index';

	const { form }: { form: SuperForm<Config> } = $props();
	const { form: formData } = $derived(form);
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
