<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { resourceDefinitions } from '$lib/resources';
	import { draggable } from '@thisux/sveltednd';
</script>

<Sidebar.Group class="py-0">
	<Sidebar.GroupLabel class="text-xs font-semibold tracking-wide uppercase">
		Resources
	</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<Sidebar.Menu>
			{#each Object.entries(resourceDefinitions) as [resource, definition] (resource)}
				<Sidebar.MenuItem>
					<div use:draggable={{ container: 'component-sidebar', dragData: resource }}>
						<Sidebar.MenuButton
							class="cursor-grab text-sm active:cursor-grabbing [&>svg]:size-4.5 [&>svg]:text-resource-icon"
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
