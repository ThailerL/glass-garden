<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { resourceDefinitions } from '$lib/resources';
	import { draggable } from '@thisux/sveltednd';
</script>

<Sidebar.Group class="py-0">
	<Sidebar.GroupLabel class="text-sm">Resources</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<Sidebar.Menu>
			{#each Object.entries(resourceDefinitions) as [resource, definition] (resource)}
				<Sidebar.MenuItem>
					<div use:draggable={{ container: 'component-sidebar', dragData: resource }}>
						<Sidebar.MenuButton class="text-base">
							<definition.icon />
							{definition.name}
						</Sidebar.MenuButton>
					</div>
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>
