<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { resourceDefinitions, type ResourceType } from '$lib/resources';
	import { IsCompact } from '$lib/hooks/is-compact.svelte';
	import { draggable } from '@thisux/sveltednd';

	// A drag says where the node goes and a tap does not, so the canvas decides instead
	const { onTap }: { onTap: (resource: ResourceType) => void } = $props();

	// Where the palette opens as a sheet, a drag cannot reach the canvas behind it
	const isCompact = new IsCompact();
</script>

<Sidebar.Group class="py-0">
	<Sidebar.GroupLabel class="text-xs font-semibold tracking-wide uppercase">
		Resources
	</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<Sidebar.Menu>
			{#each Object.entries(resourceDefinitions) as [resource, definition] (resource)}
				<Sidebar.MenuItem>
					<div
						use:draggable={{
							container: 'component-sidebar',
							dragData: resource,
							disabled: isCompact.current
						}}
					>
						<Sidebar.MenuButton
							class="text-sm [&>svg]:size-4.5 [&>svg]:text-resource-icon
							       {isCompact.current ? '' : 'cursor-grab active:cursor-grabbing'}"
							onclick={isCompact.current ? () => onTap(resource as ResourceType) : undefined}
						>
							<definition.icon />
							{definition.name}
						</Sidebar.MenuButton>
					</div>
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>
