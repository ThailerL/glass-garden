<script lang="ts">
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';

	const { form } = $props();
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
