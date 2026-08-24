<script lang="ts">
	import SquareFunctionIcon from '@lucide/svelte/icons/square-function';
	import ServerIcon from '@lucide/svelte/icons/server';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { draggable } from '@thisux/sveltednd';

	const items = [
		{
			title: 'Function',
			icon: SquareFunctionIcon,
			nodeType: 'function'
		},
		{
			title: 'Instance Group',
			icon: ServerIcon,
			nodeType: 'instanceGroup'
		},
		{
			title: 'Load Balancer',
			icon: NetworkIcon,
			nodeType: 'loadBalancer'
		}
	];
</script>

<Sidebar.Root>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Components</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each items as item (item.title)}
						<Sidebar.MenuItem>
							<div use:draggable={{ container: 'component-sidebar', dragData: item.nodeType }}>
								<Sidebar.MenuButton>
									<item.icon />
									{item.title}
								</Sidebar.MenuButton>
							</div>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
</Sidebar.Root>
