<script lang="ts">
	import { untrack } from 'svelte';
	import { cn } from '$lib/utils';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as ButtonGroup from '$lib/components/ui/button-group';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as UnderlineTabs from '$lib/components/ui/underline-tabs';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import FilePenIcon from '@lucide/svelte/icons/file-pen';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getGraphState, nodeName } from '$lib/graph-state.svelte';
	import { inspectorState } from '$lib/inspector-state.svelte';
	import { getResourceDefinition } from '$lib/resources';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import ConfigTab from './ConfigTab.svelte';
	import PreviewTab from './PreviewTab.svelte';
	import LogsTab from './LogsTab.svelte';

	const { nodeId }: { nodeId: string } = $props();

	const swappedNode = untrack(() => {
		const previous = inspectorState.shownNodeId;
		inspectorState.shownNodeId = nodeId;
		return previous !== undefined && previous !== nodeId;
	});
	const orchestrator = getOrchestrator();
	const graphState = getGraphState();

	const node = $derived(graphState.getNode(nodeId));
	const status = $derived(orchestrator.getStatus(nodeId));

	const up = $derived(orchestrator.getUpCount(nodeId));
	const configured = $derived(orchestrator.getConfiguredCount(nodeId));
	const restarts = $derived(orchestrator.getRestarts(nodeId));
	const editing = $derived(page.route.id === '/edit/[nodeId]');
	const definition = $derived(node && getResourceDefinition(node.type));
	const name = $derived(node && nodeName(node));
	const editable = $derived(!!definition && definition.hasEditableFiles);

	// Preview is the one tab a node can lack, so a resource without one falls back rather
	// than showing an empty panel for a tab it never rendered
	$effect(() => {
		if (inspectorState.tab === 'preview' && !definition?.hasPreview) inspectorState.tab = 'config';
	});
</script>

<Sidebar.Root
	side="right"
	collapsible="none"
	class={cn('w-full!', swappedNode && 'animate-in duration-150 fade-in')}
>
	{#if definition}
		<Sidebar.Header class="flex-row items-center gap-2 px-3 pt-3 pb-1">
			<definition.icon class="size-5 shrink-0" />
			<span class="truncate font-medium">{name}</span>
		</Sidebar.Header>
	{/if}
	<Sidebar.Content>
		<Sidebar.Group class="h-full">
			<Sidebar.GroupContent class="h-full">
				<UnderlineTabs.Root bind:value={inspectorState.tab} class="h-full">
					<UnderlineTabs.List>
						<UnderlineTabs.Trigger value="config">Config</UnderlineTabs.Trigger>
						{#if definition?.hasPreview}
							<UnderlineTabs.Trigger value="preview" data-tour="preview-tab">
								Preview
							</UnderlineTabs.Trigger>
						{/if}
						<UnderlineTabs.Trigger value="logs">Logs</UnderlineTabs.Trigger>
					</UnderlineTabs.List>
					<UnderlineTabs.Content value="config" class="flex flex-col">
						<ConfigTab {nodeId} />
					</UnderlineTabs.Content>
					{#if definition?.hasPreview}
						<UnderlineTabs.Content value="preview">
							<PreviewTab {nodeId} />
						</UnderlineTabs.Content>
					{/if}
					<UnderlineTabs.Content value="logs" class="min-h-0 flex-1">
						<LogsTab {nodeId} />
					</UnderlineTabs.Content>
				</UnderlineTabs.Root>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer>
		{#if editing}
			<Button variant="outline" href={resolve('/')}>
				<ArrowLeftIcon />
				Back to Canvas
			</Button>
		{:else if editable}
			<Button variant="outline" data-tour="edit-code" href={resolve('/edit/[nodeId]', { nodeId })}>
				<FilePenIcon />
				Edit Resource Code
			</Button>
		{/if}

		<div class="flex flex-row items-center justify-between gap-2">
			<div class="flex items-center gap-1.5 text-sm">
				<StatusDot {status} />
				<span class="capitalize">{status}</span>
				{#if configured > 1}
					<span class="text-muted-foreground" title="Instances running out of the configured count">
						{up}/{configured}
					</span>
				{/if}
				{#if restarts > 0}
					<span class="text-muted-foreground" title="Automatic restarts since the last start">
						· {restarts} restart{restarts === 1 ? '' : 's'}
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
		</div>
	</Sidebar.Footer>
</Sidebar.Root>
