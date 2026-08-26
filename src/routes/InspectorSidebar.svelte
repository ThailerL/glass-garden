<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as ButtonGroup from '$lib/components/ui/button-group';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as UnderlineTabs from '$lib/components/ui/underline-tabs';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getResourceDefinition } from '$lib/resource-definitions';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import ConfigTab from './ConfigTab.svelte';
	import PreviewTab from './PreviewTab.svelte';

	const { nodeId }: { nodeId: string } = $props();
	const orchestrator = getOrchestrator();
	const graphState = getGraphState();

	const node = $derived(graphState.getNode(nodeId));
	const status = $derived(orchestrator.getStatus(nodeId));

	// A stopping instance still owns its process and its port until the kill lands, so it
	// counts as up and the number ticks down as each one actually dies
	const up = $derived(
		orchestrator
			.getInstances(nodeId)
			.filter(({ status }) => status === 'running' || status === 'stopping').length
	);
	const desired = $derived(node ? getResourceDefinition(node).instanceCount(node) : 0);
</script>

<Sidebar.Root side="right">
	<Sidebar.Content>
		<Sidebar.Group class="h-full">
			<Sidebar.GroupContent class="h-full">
				<UnderlineTabs.Root value="config" class="h-full">
					<UnderlineTabs.List>
						<UnderlineTabs.Trigger value="config">Config</UnderlineTabs.Trigger>
						<UnderlineTabs.Trigger value="preview">Preview</UnderlineTabs.Trigger>
					</UnderlineTabs.List>
					<UnderlineTabs.Content value="config">
						<ConfigTab {nodeId} />
					</UnderlineTabs.Content>
					<UnderlineTabs.Content value="preview">
						<PreviewTab {nodeId} />
					</UnderlineTabs.Content>
				</UnderlineTabs.Root>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer class="flex-row items-center justify-between gap-2">
		<div class="flex items-center gap-1.5 text-sm">
			<StatusDot {status} />
			<span class="capitalize">{status}</span>
			{#if desired > 1}
				<span class="text-muted-foreground" title="Instances running out of the configured count">
					{up}/{desired}
				</span>
			{/if}
		</div>

		<ButtonGroup.Root>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							disabled={!orchestrator.canStart(nodeId)}
							onclick={() => orchestrator.start(nodeId)}
						>
							<PlayIcon />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Start</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							disabled={!orchestrator.canStop(nodeId)}
							onclick={() => orchestrator.stop(nodeId)}
						>
							<SquareIcon />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Stop</Tooltip.Content>
			</Tooltip.Root>
		</ButtonGroup.Root>
	</Sidebar.Footer>
</Sidebar.Root>
