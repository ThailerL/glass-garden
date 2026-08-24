<script lang="ts">
	import { useSvelteFlow, useUpdateNodeInternals, type Node } from '@xyflow/svelte';
	import type { Component } from 'svelte';
	import { superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { resourceDefinitions } from '$lib/resource-definitions';
	import * as Form from '$lib/components/ui/form';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { getGraphState } from '$lib/graph-state.svelte';

	const { node, SettingsComponent }: { node: Node; SettingsComponent: Component } = $props();
	const graphState = getGraphState();

	const { updateNodeData } = useSvelteFlow();
	const updateNodeInternals = useUpdateNodeInternals();

	const schema = resourceDefinitions[node.type].settingsSchema;
	const form = $derived.by(() => {
		const form = superForm(zod4(schema), {
			SPA: true,
			validators: zod4(schema),
			dataType: 'json',
			resetForm: false
		});
		form.reset({ data: node.data });
		return form;
	});
	const { form: formData, validateForm, errors } = $derived(form);

	async function handleSubmit() {
		const result = await validateForm();

		if (!result.valid) {
			errors.update((v) => {
				return {
					...v,
					...result.errors
				};
			});

			return;
		}

		// We only want fields related to the node, not any of the SuperForm fields
		const {
			constraints: _constraints,
			defaults: _defaults,
			id: _id,
			jsonSchema: _jsonSchema,
			shape: _shape,
			superFormValidationLibrary: _superFormValidationLibrary,
			validate: _validate,
			...nodeData
		} = $formData;

		updateNodeData(node.id, nodeData);
		updateNodeInternals(node.id);
		node.data = nodeData; // updateNodeData takes time to propagate so instantly update here
		graphState.setNodeInStorage(node);
		toast.success('Successfully saved settings', { position: 'bottom-center', duration: 2000 });
	}
</script>

<Sidebar.Root side="right">
	<Sidebar.Header>Settings for {node.data.name}</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<form method="dialog" onsubmit={handleSubmit}>
					<SettingsComponent {form} {node} />
				</form>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer>
		<Form.Button type="submit" onclick={handleSubmit}>Save changes</Form.Button>
	</Sidebar.Footer>
</Sidebar.Root>
