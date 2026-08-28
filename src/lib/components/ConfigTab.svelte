<script lang="ts">
	import { untrack } from 'svelte';
	import { z } from 'zod';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { resourceDefinitions, type ResourceType } from '$lib/resources';
	import * as Form from '$lib/components/ui/form';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';

	const { nodeId }: { nodeId: string } = $props();
	const graphState = getGraphState();
	const orchestrator = getOrchestrator();

	// Read once because the graph replaces the node object on every drag, and
	// re-reading it would rebuild the form and discard whatever is being typed
	const node = untrack(() => {
		const found = graphState.getNode(nodeId);
		if (!found) throw new Error(`Unknown node: ${nodeId}`);
		return found;
	});

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

		graphState.updateNodeData(node.id, $formData);
		// A running node reconciles toward the new config immediately
		orchestrator.refresh(node.id);
		toast.success('Successfully saved config');
	}
</script>

<div class="min-h-0 flex-1 overflow-y-auto">
	<form method="dialog" onsubmit={handleSubmit}>
		<ConfigComponent {form} />
	</form>
</div>
<div class="-mx-2 -mb-2 border-t border-sidebar-border bg-sidebar p-2">
	<Form.Button type="submit" onclick={handleSubmit}>Save changes</Form.Button>
</div>
