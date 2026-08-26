<script lang="ts">
	import * as ButtonGroup from '$lib/components/ui/button-group';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
	import StatusDot from '$lib/components/StatusDot.svelte';

	const graphState = getGraphState();
	const orchestrator = getOrchestrator();

	// Worst first, so the summary reports whichever resource most needs attention
	const STATUS_PRECEDENCE: ResourceStatus[] = [
		'unresponsive',
		'crashed',
		'degraded',
		'starting',
		'stopping',
		'running',
		'stopped'
	];

	const status = $derived.by(() => {
		const statuses = graphState.nodes.map((node) => orchestrator.getStatus(node.id));
		return STATUS_PRECEDENCE.find((candidate) => statuses.includes(candidate)) ?? 'stopped';
	});

	const startDisabled = $derived(graphState.nodes.every((node) => !orchestrator.canStart(node.id)));
	const stopDisabled = $derived(graphState.nodes.every((node) => !orchestrator.canStop(node.id)));
</script>

<div
	class="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3
         rounded-full border bg-background px-3 py-1.5 shadow-lg backdrop-blur"
>
	<div class="flex items-center gap-1.5">
		<StatusDot {status} />
		<span class="capitalize">{status}</span>
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
