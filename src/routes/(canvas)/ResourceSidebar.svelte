<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { resourceDefinitions } from '$lib/resources';
	import { draggable } from '@thisux/sveltednd';
</script>

<Sidebar.Root collapsible="none" class="w-full!">
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Resources</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each Object.entries(resourceDefinitions) as [resource, definition] (resource)}
						<Sidebar.MenuItem>
							<div use:draggable={{ container: 'component-sidebar', dragData: resource }}>
								<Sidebar.MenuButton>
									<definition.icon />
									{definition.name}
								</Sidebar.MenuButton>
							</div>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
</Sidebar.Root>
