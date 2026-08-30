<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import type { Config } from './index';

	const { form }: { form: SuperForm<Config> } = $props();
	const { form: formData } = $derived(form);
</script>

<Form.Field {form} name="name">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label>Name</Form.Label>
			<Input {...props} bind:value={$formData.name} />
		{/snippet}
	</Form.Control>
	<Form.FieldErrors />
</Form.Field>
<Form.Field {form} name="instanceCount">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label>Instance Count</Form.Label>
			<Input type="number" {...props} bind:value={$formData.instanceCount} />
		{/snippet}
	</Form.Control>
	<Form.FieldErrors />
</Form.Field>
<Form.Field {form} name="command">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label>Command</Form.Label>
			<Input {...props} bind:value={$formData.command} />
		{/snippet}
	</Form.Control>
	<Form.FieldErrors />
</Form.Field>
