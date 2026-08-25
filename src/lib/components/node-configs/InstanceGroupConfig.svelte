<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';

	const { form, node } = $props();
	const { form: formData } = $derived(form);
</script>

<Form.Button type="button" href={resolve('/edit/[nodeId]', { nodeId: node.id })} target="_blank">
	Edit Service Code
</Form.Button>
<Form.Field {form} name="name">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label>Name</Form.Label>
			<Input {...props} bind:value={$formData.name} />
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
<Form.Field {form} name="port">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label>Port</Form.Label>
			<Input type="number" {...props} bind:value={$formData.port} />
		{/snippet}
	</Form.Control>
	<Form.FieldErrors />
</Form.Field>
