<script lang="ts">
	import * as ButtonGroup from '$lib/components/ui/button-group';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import type { ResourceStatus } from '$lib/resources';
	import { getGraphState } from '$lib/graph-state.svelte';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import { STATUS_TEXT } from '$lib/status';
	import { Spinner } from '$lib/components/ui/spinner';

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
	data-tour="controls"
	class="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full
	       border bg-background/75 px-3.5 py-1.5 text-sm shadow-md backdrop-blur-md"
>
	<!-- Start is not blocked while this shows: a start queues on the same boot -->
	<div class="flex items-center gap-1.5">
		{#if orchestrator.containerError}
			<TriangleAlertIcon class="size-3.5 text-destructive" />
			<span class="text-muted-foreground" title={orchestrator.containerError}>Boot failed</span>
		{:else if orchestrator.warmingRegion}
			<Spinner class="size-3 text-muted-foreground" />
			<span class="text-muted-foreground">Booting AWS</span>
		{:else if orchestrator.containerReady}
			<StatusDot {status} />
			<span>{STATUS_TEXT[status]}</span>
		{:else}
			<Spinner class="size-3 text-muted-foreground" />
			<span class="text-muted-foreground">
				{orchestrator.restoringDatabase ? 'Restoring database files' : 'Booting'}
			</span>
		{/if}
	</div>

	<ButtonGroup.Root>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						data-tour="run"
						variant="outline"
						disabled={startDisabled}
						aria-label="Start all resources"
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
						aria-label="Stop all resources"
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
