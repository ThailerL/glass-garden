<script lang="ts">
	import { useSvelteFlow, useUpdateNodeInternals, type Node } from '@xyflow/svelte';
	import type { Component } from 'svelte';
	import { superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { schemas } from '$lib/schemas';
	import * as Form from '$lib/components/ui/form';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { getInfrastructueState } from '$lib/infrastructure-state.svelte';

	const { node, SettingsComponent }: { node: Node; SettingsComponent: Component } = $props();
	const infraState = getInfrastructueState();

	const { updateNodeData } = useSvelteFlow();
	const updateNodeInternals = useUpdateNodeInternals();

	const form = $derived.by(() => {
		const form = superForm(zod4(schemas[node.type]), {
			SPA: true,
			validators: zod4(schemas[node.type]),
			dataType: 'json',
			resetForm: false
		});
		form.reset({ data: node.data });
		return form;
	});

	const { form: formData, validateForm, errors } = $derived(form);

	let onSave = () => {};
	function useOnSave(onsave: () => void) {
		onSave = onsave;
	}

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
		/* eslint-disable @typescript-eslint/no-unused-vars */
		const {
			constraints,
			defaults,
			id,
			jsonSchema,
			shape,
			superFormValidationLibrary,
			validate,
			...nodeData
		} = $formData;
		/* eslint-enable @typescript-eslint/no-unused-vars */

		updateNodeData(node.id, nodeData);
		onSave();
		updateNodeInternals(node.id);
		node.data = nodeData; // updateNodeData takes time to propagate so instantly update here
		infraState.saveNodeCanvasDataInStorage(node);
		toast.success('Successfully saved settings', { position: 'bottom-center', duration: 2000 });
	}
</script>

<Sidebar.Root side="right">
	<Sidebar.Header>Settings for {node.data.name}</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<form method="dialog" onsubmit={handleSubmit}>
					<SettingsComponent {useOnSave} {form} {node} />
				</form>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer>
		<Form.Button type="submit" onclick={handleSubmit}>Save changes</Form.Button>
	</Sidebar.Footer>
</Sidebar.Root>
