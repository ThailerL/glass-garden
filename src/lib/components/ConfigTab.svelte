<script module lang="ts">
	// Key order follows however each object was built, so it must not read as a change
	const canonical = (config: Record<string, unknown>) =>
		JSON.stringify(config, (_, value) =>
			value && typeof value === 'object' && !Array.isArray(value)
				? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
				: value
		);

	export function configsMatch(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
		return canonical(a) === canonical(b);
	}
</script>

<script lang="ts">
	import { untrack, type Component } from 'svelte';
	import { z } from 'zod';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { getResourceDefinition } from '$lib/resources';
	import * as Form from '$lib/components/ui/form';
	import ClearDataButton from '$lib/components/ClearDataButton.svelte';
	import {
		getGraphState,
		nameTakenByChallenge,
		nodeAuthored,
		nodeConfig,
		nodeName
	} from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getEditingLock, LOCKED_UNTIL_RUN_ENDS } from '$lib/challenge-run.svelte';
	import { launchPlan } from '$lib/resource-controller.svelte';
	import { getProject } from '$lib/projects.svelte';
	import { fixesSetting } from '$lib/challenge';
	import { setFixedSettings } from '$lib/challenge-settings';

	const { nodeId }: { nodeId: string } = $props();
	const graphState = getGraphState();
	const orchestrator = getOrchestrator();
	const lock = getEditingLock();

	// Read once, during init, because the graph replaces the node object on every drag and a
	// later read would rebuild the form and discard whatever is being typed. The snapshot
	// detaches the seed data from the graph, so this holds however `nodes` is declared
	const { node, initialData } = untrack(() => {
		const found = graphState.getNode(nodeId);
		if (!found) throw new Error(`Unknown node: ${nodeId}`);
		return { node: found, initialData: $state.snapshot(nodeConfig(found)) };
	});

	const definition = getResourceDefinition(node.type);
	const schema: z.ZodObject<z.ZodRawShape> = definition.configSchema;

	// A challenge owns the settings that define what it puts the reader's system through
	setFixedSettings(
		fixesSetting(getProject(graphState.projectId)?.challenge, {
			name: nodeName(node),
			authored: nodeAuthored(node)
		})
	);

	const form = superForm(defaults(initialData, zod4(schema), { id: node.id }), {
		SPA: true,
		validators: zod4(schema),
		dataType: 'json',
		resetForm: false
	});

	const ConfigComponent = definition.configComponent as Component<{
		form: typeof form;
		nodeId: string;
	}>;
	const { form: formData, validateForm, errors } = form;

	// Read live, unlike the node the form was seeded from, so a save settles what follows
	const liveNode = $derived(graphState.getNode(nodeId));

	const isDirty = $derived(!!liveNode && !configsMatch($formData, nodeConfig(liveNode)));

	// The same comparison #reconcilePass makes, so it cannot disagree with what happens
	const bouncedInstances = $derived.by(() => {
		// Re-applying an always-on resource's settings restarts nothing of its own
		if (definition.alwaysOn) return 0;
		const upCount = orchestrator.getUpCount(nodeId);
		if (!liveNode || upCount === 0) return 0;

		const neighbours = orchestrator.getNeighbours(nodeId);
		const pending = { ...liveNode, data: { ...liveNode.data, config: $formData } };
		return launchPlan(definition, liveNode, neighbours).stamp ===
			launchPlan(definition, pending, neighbours).stamp
			? 0
			: upCount;
	});

	// The count only tells the user something once there is more than one instance to lose
	const saveLabel = $derived(
		lock.current
			? LOCKED_UNTIL_RUN_ENDS
			: bouncedInstances === 0
				? 'Save config'
				: bouncedInstances === 1
					? 'Save and restart'
					: `Save and restart ${bouncedInstances} instances`
	);

	async function handleSubmit() {
		if (!isDirty || lock.current) return;
		const result = await validateForm();

		if (!result.valid) {
			errors.update((v) => ({ ...v, ...result.errors }));
			return;
		}
		if (nameTakenByChallenge(graphState.nodes, node, $formData.name)) {
			errors.update((v) => ({ ...v, name: ['Another node of the challenge already uses that.'] }));
			return;
		}

		graphState.updateNodeConfig(node.id, $formData);
		// A running node reconciles toward the new config immediately
		orchestrator.refresh(node.id);
		toast.success('Saved config');
	}

	// Keystrokes from the fields bubble here, so the shortcut is the form's own rather than the
	// window's and cannot answer for the editor or the terminal
	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			void handleSubmit();
		}
	}
</script>

<div class="min-h-0 flex-1 overflow-y-auto">
	<!-- Spaced here so every config component stacks its fields the same way -->
	<!-- The handler catches keystrokes from the fields; the form itself is not a control -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form method="POST" onsubmit={handleSubmit} onkeydown={handleKeydown} class="space-y-4 py-1">
		<ConfigComponent {form} {nodeId} />
		<!-- Offered by the resource holding the data rather than by each config component -->
		{#if definition.clear}
			<ClearDataButton {nodeId} />
		{/if}
	</form>
</div>
<div class="-mx-2 -mb-2 border-t border-sidebar-border bg-sidebar p-2">
	<Form.Button type="submit" disabled={!isDirty || lock.current} onclick={handleSubmit}>
		{saveLabel}
	</Form.Button>
</div>
