<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Form from '$lib/components/ui/form';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';

	const { form, node } = $props();
	const { form: formData } = $derived(form);
</script>

<Form.Button type="button" href={resolve('/edit/[nodeId]', { nodeId: node.id })} target="_blank">
	Edit Service Code
</Form.Button>
<Form.Field {form} name="data.name">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label>Name</Form.Label>
			<Input {...props} bind:value={$formData.name} />
		{/snippet}
	</Form.Control>
	<Form.FieldErrors />
</Form.Field>
<Form.Field {form} name="data.runtime">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label>Runtime</Form.Label>
			<RadioGroup.Root {...props} bind:value={$formData.runtime}>
				<div class="flex items-center space-x-2">
					<RadioGroup.Item value="node.js" id="node.js" />
					<Label for="node.js">Node.JS</Label>
				</div>
			</RadioGroup.Root>
		{/snippet}
	</Form.Control>
	<Form.FieldErrors />
</Form.Field>
