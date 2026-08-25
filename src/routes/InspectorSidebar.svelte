<script lang="ts">
	import { useSvelteFlow, type Node } from '@xyflow/svelte';
	import { untrack, type Component } from 'svelte';
	import { z } from 'zod';
	import { superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { resourceDefinitions, type ResourceType } from '$lib/resource-definitions';
	import * as Form from '$lib/components/ui/form';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { getGraphState } from '$lib/graph-state.svelte';

	const {
		node,
		ConfigComponent
	}: { node: Node; ConfigComponent: Component<{ form: unknown; node: Node }> } = $props();
	const graphState = getGraphState();

	const { updateNodeData } = useSvelteFlow();

	const schema: z.ZodObject<z.ZodRawShape> = untrack(
		() => resourceDefinitions[node.type as ResourceType].configSchema
	);
	const form = $derived.by(() => {
		const form = superForm(zod4(schema), {
			SPA: true,
			validators: zod4(schema),
			dataType: 'json',
			resetForm: false
		});
		form.reset({ data: node.data.config as Record<string, unknown> });
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

		const nodeConfig = $formData;
		node.data.config = nodeConfig;
		updateNodeData(node.id, node.data);
		graphState.setNodeInStorage(node);
		toast.success('Successfully saved config', { position: 'bottom-center', duration: 2000 });
	}
</script>

<Sidebar.Root side="right">
	<Sidebar.Header>Config for {node.data.name}</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<form method="dialog" onsubmit={handleSubmit}>
					<ConfigComponent {form} {node} />
				</form>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer>
		<Form.Button type="submit" onclick={handleSubmit}>Save changes</Form.Button>
	</Sidebar.Footer>
</Sidebar.Root>
