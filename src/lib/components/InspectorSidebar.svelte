<script lang="ts">
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
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getResourceDefinition } from '$lib/resources';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import ConfigTab from './ConfigTab.svelte';
	import PreviewTab from './PreviewTab.svelte';
	import EventsTab from './EventsTab.svelte';

	const { nodeId }: { nodeId: string } = $props();
	const orchestrator = getOrchestrator();
	const graphState = getGraphState();

	const node = $derived(graphState.getNode(nodeId));
	const status = $derived(orchestrator.getStatus(nodeId));

	const up = $derived(orchestrator.getUpCount(nodeId));
	const desired = $derived(orchestrator.getDesiredCount(nodeId));
	const restarts = $derived(orchestrator.getRestarts(nodeId));
	const editing = $derived(page.route.id === '/edit/[nodeId]');
	const editable = $derived(!!node && getResourceDefinition(node.type).hasEditableFiles);
</script>

<Sidebar.Root side="right" collapsible="none" class="w-full!">
	<Sidebar.Content>
		<Sidebar.Group class="h-full">
			<Sidebar.GroupContent class="h-full">
				<UnderlineTabs.Root value="config" class="h-full">
					<UnderlineTabs.List>
						<UnderlineTabs.Trigger value="config">Config</UnderlineTabs.Trigger>
						<UnderlineTabs.Trigger value="preview">Preview</UnderlineTabs.Trigger>
						<UnderlineTabs.Trigger value="events">Events</UnderlineTabs.Trigger>
					</UnderlineTabs.List>
					<UnderlineTabs.Content value="config" class="flex flex-col">
						<ConfigTab {nodeId} />
					</UnderlineTabs.Content>
					<UnderlineTabs.Content value="preview">
						<PreviewTab {nodeId} />
					</UnderlineTabs.Content>
					<UnderlineTabs.Content value="events" class="overflow-y-auto">
						<EventsTab {nodeId} />
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
			<Button variant="outline" href={resolve('/edit/[nodeId]', { nodeId })}>
				<FilePenIcon />
				Edit Resource Code
			</Button>
		{/if}

		<div class="flex flex-row items-center justify-between gap-2">
			<div class="flex items-center gap-1.5 text-sm">
				<StatusDot {status} />
				<span class="capitalize">{status}</span>
				{#if desired > 1}
					<span class="text-muted-foreground" title="Instances running out of the configured count">
						{up}/{desired}
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
