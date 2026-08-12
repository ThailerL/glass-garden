<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import { schemas } from '$lib/schemas';
	import DoubleClickMenu from '$lib/components/DoubleClickMenu.svelte';
	import { v4 as uuidv4 } from 'uuid';

	let { data, id }: NodeProps = $props();

	const form = superForm(defaults(zod4(schemas.loadBalancer)), {
		SPA: true,
		validators: zod4(schemas.loadBalancer),
		dataType: 'json',
		id
	});
	const { form: formData } = form;

	function removeTargetGroup(index: number) {
		$formData.targetGroups = $formData.targetGroups.filter((_, i) => i !== index);
	}
	function addTargetGroup() {
		$formData.targetGroups = [
			...$formData.targetGroups,
			{ id: uuidv4(), name: 'Target Group', weight: 1 }
		];
	}
</script>

{#snippet node()}
	{data.name}
	<img
		src="https://symbols.getvecta.com/stencil_9/39_load-balancer.af7d4495ba.svg"
		alt="Load balancer icon"
	/>
	<Handle type="target" position={Position.Left} />
	{#each data.targetGroups as targetGroup, i (targetGroup.id)}
		<Handle
			type="source"
			position={Position.Right}
			id={targetGroup.id}
			style="top: {((i + 1) * 100) / (data.targetGroups.length + 1)}%"
		/>
	{/each}
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
	<Form.Fieldset {form} name="targetGroups">
		<Form.Legend>Target Groups</Form.Legend>
		<div class="grid grid-cols-3 gap-2">
			<Form.Description>Name</Form.Description>
			<Form.Description>Weight</Form.Description>
			<span></span>
			{#each $formData.targetGroups as _, i (_.id)}
				<Form.ElementField {form} name="targetGroups[{i}].name">
					<Form.Control>
						{#snippet children(props)}
							<Input {...props} bind:value={$formData.targetGroups[i].name} />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.ElementField>
				<Form.ElementField {form} name="targetGroups[{i}].weight">
					<Form.Control>
						{#snippet children(props)}
							<Input {...props} type="number" bind:value={$formData.targetGroups[i].weight} />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.ElementField>
				<Form.Button type="button" onclick={() => removeTargetGroup(i)}>Remove</Form.Button>
			{/each}
		</div>
		<Form.Button type="button" onclick={addTargetGroup}>Add Target Group</Form.Button>
	</Form.Fieldset>
</DoubleClickMenu>
