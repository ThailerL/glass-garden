<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import { createProject, openProject } from '$lib/projects.svelte';
	import { buildTourCanvas } from '$lib/tour.svelte';

	// A fresh canvas each time, since the one the tour first ran on may no longer match its steps
	function takeTour() {
		openProject(createProject('Tour', buildTourCanvas).id);
	}
</script>

<Collapsible.Root open class="group/collapsible">
	<Sidebar.Group class="py-0">
		<Sidebar.GroupLabel class="text-xs font-semibold tracking-wide uppercase">
			{#snippet child({ props })}
				<Collapsible.Trigger {...props}>
					<!-- The items open below the label, so closed it points up -->
					<ChevronUpIcon
						class="mr-1 transition-transform group-data-[state=open]/collapsible:rotate-180"
					/>
					Learn
				</Collapsible.Trigger>
			{/snippet}
		</Sidebar.GroupLabel>

		<Collapsible.Content>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton class="text-sm" onclick={takeTour}>
							Take the tour
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Collapsible.Content>
	</Sidebar.Group>
</Collapsible.Root>
