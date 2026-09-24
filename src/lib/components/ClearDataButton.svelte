<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import EraserIcon from '@lucide/svelte/icons/eraser';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getEditingLock } from '$lib/challenge-run.svelte';
	import { getGraphState, nodeName } from '$lib/graph-state.svelte';
	import { getResourceDefinition } from '$lib/resources';

	const { nodeId }: { nodeId: string } = $props();

	const orchestrator = getOrchestrator();
	const graphState = getGraphState();
	const lock = getEditingLock();

	const node = $derived(graphState.getNode(nodeId));
	const definition = $derived(node ? getResourceDefinition(node.type) : undefined);
	const status = $derived(orchestrator.getStatus(nodeId));

	// A resource with a process of its own holds its data open while it runs; the region's hold
	// nothing open, so those clear where they stand
	const held = $derived(definition?.runsProcesses === true && status !== 'stopped');
	const why = $derived(lock.current ? 'Wait for the run to end' : held ? 'Stop it first' : '');

	function confirmClear() {
		const name = node ? nodeName(node) : 'this resource';
		confirmDelete({
			title: 'Clear stored data?',
			description: `Deletes everything ${name} is holding.`,
			confirm: { text: 'Clear data' },
			onConfirm: async () => {
				if (await orchestrator.clearNodeData(nodeId)) toast.success(`Cleared ${name}`);
			}
		});
	}
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<!-- Wrapped because a disabled button emits no pointer events for the tooltip -->
			<div {...props} class="w-fit">
				<Button
					variant="outline"
					aria-label="Clear data"
					disabled={why !== ''}
					onclick={confirmClear}
				>
					<EraserIcon />
				</Button>
			</div>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>{why || 'Clear data'}</Tooltip.Content>
</Tooltip.Root>
