<script lang="ts">
	import * as ButtonGroup from '$lib/components/ui/button-group';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';

	const graphState = getGraphState();
	const orchestrator = getOrchestrator();

	const startDisabled = $derived(
		graphState.nodes.every((node) =>
			['running', 'starting', 'stopping'].includes(orchestrator.getStatus(node.id))
		)
	);
	const stopDisabled = $derived(
		graphState.nodes.every((node) =>
			['stopped', 'starting', 'stopping'].includes(orchestrator.getStatus(node.id))
		)
	);
</script>

<div
	class="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3
         rounded-full border bg-background px-3 py-1.5 shadow-lg backdrop-blur"
>
	<div class="flex items-center gap-1.5">
		<span class="size-2 rounded-full bg-muted-foreground"></span>
		<span class="capitalize">status</span>
	</div>

	<ButtonGroup.Root>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="outline"
						disabled={startDisabled}
						onclick={() => orchestrator.startAll()}
					>
						<PlayIcon />
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>Start all resources</Tooltip.Content>
		</Tooltip.Root>

		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="outline"
						disabled={stopDisabled}
						onclick={() => orchestrator.stopAll()}
					>
						<SquareIcon />
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>Stop all resources</Tooltip.Content>
		</Tooltip.Root>
	</ButtonGroup.Root>
</div>
