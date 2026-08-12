<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import * as Form from '$lib/components/ui/form';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { schemas } from '$lib/schemas';
	import DoubleClickMenu from '$lib/components/DoubleClickMenu.svelte';

	let { data, id }: NodeProps = $props();

	const form = superForm(defaults(zod4(schemas.service)), {
		SPA: true,
		validators: zod4(schemas.service),
		id
	});
	const { form: formData } = form;
</script>

{#snippet node()}
	<Handle type="target" position={Position.Left} />
	{data.name}
	<img src="https://www.svgrepo.com/show/474373/cloud-server.svg" alt="Service icon" />
{/snippet}

<DoubleClickMenu {data} {id} {form} {node}>
	<Form.Field {form} name="name">
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label>Name</Form.Label>
				<Input {...props} bind:value={$formData.name} />
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>
	<Form.Field {form} name="runtime">
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
</DoubleClickMenu>
