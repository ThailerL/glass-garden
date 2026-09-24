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

	// A running process holds its data open, unless clearing it is restarting it
	const held = $derived(
		definition?.runsProcesses === true && definition.clear !== 'restart' && status !== 'stopped'
	);
	const words = $derived(
		definition?.clearWords ?? { action: 'Clear data', title: 'Clear stored data?', done: 'Cleared' }
	);
	const why = $derived(lock.current ? 'Wait for the run to end' : held ? 'Stop it first' : '');

	function confirmClear() {
		const name = node ? nodeName(node) : 'this resource';
		confirmDelete({
			title: words.title,
			description: `Deletes everything ${name} is holding.`,
			confirm: { text: words.action },
			onConfirm: async () => {
				if (await orchestrator.clearNodeData(nodeId)) toast.success(`${words.done} ${name}`);
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
					aria-label={words.action}
					disabled={why !== ''}
					onclick={confirmClear}
				>
					<EraserIcon />
				</Button>
			</div>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>{why || words.action}</Tooltip.Content>
</Tooltip.Root>
