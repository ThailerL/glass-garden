<script lang="ts">
	import { useSvelteFlow, useUpdateNodeInternals, type Node } from '@xyflow/svelte';
	import type { Component } from 'svelte';
	import * as Form from '$lib/components/ui/form';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { schemas } from '$lib/schemas';
	import { toast } from 'svelte-sonner';

	const { node, InspectorComponent }: { node: Node; InspectorComponent: Component } = $props();

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

		updateNodeData(node.id, $formData);
		onSave();
		updateNodeInternals(node.id);
		toast.success('Successfully saved settings', { position: 'bottom-center', duration: 2000 });
	}
</script>

<Sidebar.Root side="right">
	<Sidebar.Header>Settings for {node.data.name}</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<form method="dialog" onsubmit={handleSubmit}>
					<InspectorComponent {useOnSave} {form} {node} />
				</form>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer>
		<Form.Button type="submit" onclick={handleSubmit}>Save changes</Form.Button>
	</Sidebar.Footer>
</Sidebar.Root>
