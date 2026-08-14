<script lang="ts">
	import { useSvelteFlow, useUpdateNodeInternals } from '@xyflow/svelte';
	import * as Form from '$lib/components/ui/form';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { schemas } from '$lib/schemas';
	import { toast } from 'svelte-sonner';
	// import SaveCheckIcon from '@lucide/svelte/icons/save-check';

	const { node, InspectorComponent } = $props();

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
		toast.success('Successfully saved settings');
	}
</script>

<Sidebar.Root side="right">
	<Sidebar.Header>Settings for {node.data.name}</Sidebar.Header>
	<Sidebar.Content>
		<form method="dialog" onsubmit={handleSubmit}>
			<InspectorComponent {useOnSave} {form} />
			<Sidebar.Footer>
				<Form.Button type="submit">Save changes</Form.Button>
			</Sidebar.Footer>
		</form>
	</Sidebar.Content>
</Sidebar.Root>
