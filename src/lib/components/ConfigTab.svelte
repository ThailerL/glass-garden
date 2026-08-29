<script lang="ts">
	import { untrack } from 'svelte';
	import { z } from 'zod';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import {
		getResourceDefinition,
		resourceDefinitions,
		type ResourceDefinition,
		type ResourceType
	} from '$lib/resources';
	import * as Form from '$lib/components/ui/form';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { stampOf } from '$lib/resource-controller.svelte';

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

	// Typed as the interface rather than the concrete component, so every config
	// component is passed the same props whether or not it declares them
	const ConfigComponent: ResourceDefinition['configComponent'] = untrack(
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

	// Re-read live, unlike the node the form was built from, so the count settles after a
	// save. The same comparison #reconcilePass makes, so it cannot disagree with what happens
	const bouncedInstances = $derived.by(() => {
		const { launchConfig } = getResourceDefinition(node.type);
		const liveNode = graphState.getNode(nodeId);
		const upCount = orchestrator.getUpCount(nodeId);
		if (!launchConfig || !liveNode || upCount === 0) return 0;

		const upstreams = orchestrator.getUpstreams(nodeId);
		const pending = { ...liveNode, data: $formData as Record<string, unknown> };
		return stampOf(launchConfig(liveNode, upstreams)) === stampOf(launchConfig(pending, upstreams))
			? 0
			: upCount;
	});

	// The count only tells the user something once there is more than one instance to lose
	const saveLabel = $derived(
		bouncedInstances === 0
			? 'Save changes'
			: bouncedInstances === 1
				? 'Save and restart'
				: `Save and restart ${bouncedInstances} instances`
	);

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
	<!-- Spaced here so every config component stacks its fields the same way -->
	<form method="dialog" onsubmit={handleSubmit} class="space-y-2">
		<ConfigComponent {form} {nodeId} />
	</form>
</div>
<div class="-mx-2 -mb-2 border-t border-sidebar-border bg-sidebar p-2">
	<Form.Button type="submit" onclick={handleSubmit}>
		{saveLabel}
	</Form.Button>
</div>
