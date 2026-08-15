<script lang="ts">
	import SquareFunctionIcon from '@lucide/svelte/icons/square-function';
	import ServerIcon from '@lucide/svelte/icons/server';
	import ScaleIcon from '@lucide/svelte/icons/scale';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { useDnD } from './DnDProvider.svelte';

	const items = [
		{
			title: 'Function',
			icon: SquareFunctionIcon,
			nodeType: 'function'
		},
		{
			title: 'Service',
			icon: ServerIcon,
			nodeType: 'service'
		},
		{
			title: 'Load Balancer',
			icon: ScaleIcon,
			nodeType: 'loadBalancer'
		}
	];

	const type = useDnD();

	function onDragStart(event: DragEvent, nodeType: string) {
		if (!event.dataTransfer) {
			return null;
		}

		type.current = nodeType;

		event.dataTransfer.effectAllowed = 'move';
	}
</script>

<Sidebar.Root>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Components</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each items as item (item.title)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								ondragstart={(event) => onDragStart(event, item.nodeType)}
								draggable={true}
								class="cursor-grab"
							>
								<item.icon />{item.title}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
</Sidebar.Root>
