<script lang="ts">
	import { useSvelteFlow } from '@xyflow/svelte';
	import { untrack } from 'svelte';
	import { z } from 'zod';
	import { resolve } from '$app/paths';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { resourceDefinitions, type ResourceType } from '$lib/resource-definitions';
	import * as Form from '$lib/components/ui/form';
	import { getGraphState } from '$lib/graph-state.svelte';

	const { nodeId }: { nodeId: string } = $props();
	const graphState = getGraphState();

	// Read once because the graph replaces the node object on every drag, and
	// re-reading it would rebuild the form and discard whatever is being typed
	const node = untrack(() => {
		const found = graphState.getNode(nodeId);
		if (!found) throw new Error(`Unknown node: ${nodeId}`);
		return found;
	});

	const { updateNodeData } = useSvelteFlow();

	const ConfigComponent = untrack(
		() => resourceDefinitions[node.type as ResourceType].configComponent
	);
	const schema: z.ZodObject<z.ZodRawShape> = untrack(
		() => resourceDefinitions[node.type as ResourceType].configSchema
	);
	const form = $derived.by(() => {
		const form = superForm(defaults(zod4(schema), { id: node.id }), {
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
			errors.update((v) => ({ ...v, ...result.errors }));
			return;
		}

		node.data = $formData;
		updateNodeData(node.id, node.data);
		graphState.setNodeInStorage(node);
		toast.success('Successfully saved config', { position: 'bottom-center', duration: 2000 });
	}
</script>

{#if resourceDefinitions[node.type as ResourceType].hasEditableFiles}
	<Form.Button
		type="button"
		class="mb-3"
		href={resolve('/edit/[nodeId]', { nodeId: node.id })}
		target="_blank"
	>
		Edit Service Code
	</Form.Button>
{/if}
<form method="dialog" onsubmit={handleSubmit}>
	<ConfigComponent {form} />
</form>
<div class="sticky bottom-0 -mx-2 -mb-2 border-t border-sidebar-border bg-sidebar p-2">
	<Form.Button type="submit" onclick={handleSubmit}>Save changes</Form.Button>
</div>
