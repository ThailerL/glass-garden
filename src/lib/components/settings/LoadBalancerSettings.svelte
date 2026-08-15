<script lang="ts">
	import { useEdges } from '@xyflow/svelte';
	import { v4 as uuidv4 } from 'uuid';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';

	let { form, useOnSave } = $props();
	const edges = useEdges();
	const { form: formData } = $derived(form);

	let deletedTargetGroupIds: string[] = [];

	function removeTargetGroup(index: number) {
		// Source handles have the same ID as the target group they are associated with
		deletedTargetGroupIds.push($formData.targetGroups[index].id);
		$formData.targetGroups = $formData.targetGroups.filter((_: never, i: number) => i !== index);
	}

	function addTargetGroup() {
		$formData.targetGroups = [
			...$formData.targetGroups,
			{ id: uuidv4(), name: 'Target Group', weight: 1 }
		];
	}

	// svelte-ignore state_referenced_locally
	useOnSave(() => {
		for (const targetGroupId of deletedTargetGroupIds) {
			// Target groups have the same ID as the handle they live on
			edges.set(edges.current.filter((edge) => edge.sourceHandle !== targetGroupId));
		}
	});
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
						<Input
							{...props}
							type="number"
							step="any"
							bind:value={$formData.targetGroups[i].weight}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.ElementField>
			<Form.Button type="button" onclick={() => removeTargetGroup(i)}>Remove</Form.Button>
		{/each}
	</div>
	<Form.Button type="button" onclick={addTargetGroup}>Add Target Group</Form.Button>
</Form.Fieldset>
