<script lang="ts">
	import type { Node } from '@xyflow/svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as ButtonGroup from '$lib/components/ui/button-group';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as UnderlineTabs from '$lib/components/ui/underline-tabs';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import ConfigTab from './ConfigTab.svelte';
	import PreviewTab from './PreviewTab.svelte';

	const { node }: { node: Node } = $props();
	const orchestrator = getOrchestrator();
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
						<ConfigTab {node} />
					</UnderlineTabs.Content>
					<UnderlineTabs.Content value="preview">
						<PreviewTab {node} />
					</UnderlineTabs.Content>
				</UnderlineTabs.Root>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer>
		<ButtonGroup.Root>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							disabled={!orchestrator.canStart(node.id)}
							onclick={() => orchestrator.start(node.id)}
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
							disabled={!orchestrator.canStop(node.id)}
							onclick={() => orchestrator.stop(node.id)}
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
