<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { appView } from '$lib/app-view';
	import { createProject, openProject } from '$lib/projects.svelte';
	import { challengeCatalogue, loadCatalogue } from '$lib/challenge-catalogue.svelte';
	import { buildTourCanvas } from '$lib/tour.svelte';

	// An open challenge has no row of its own, so the section it came from carries the highlight
	const { challengeOpen = false }: { challengeOpen?: boolean } = $props();

	// A fresh canvas each time, since the one the tour first ran on may no longer match its steps
	function takeTour() {
		openProject(createProject('Tour', buildTourCanvas).id);
	}

	loadCatalogue();
	const { builtIn, ready } = $derived(challengeCatalogue());
	const complete = $derived(builtIn.filter((challenge) => challenge.complete).length);
</script>

<Sidebar.Group class="py-0">
	<Sidebar.Menu>
		<Sidebar.MenuItem>
			<Sidebar.MenuButton
				class="text-sm"
				isActive={appView(page.url).name === 'challenges' || challengeOpen}
			>
				{#snippet child({ props })}
					<a href={resolve('/?challenges')} {...props}>
						Challenges
						<span class="ml-auto text-xs text-muted-foreground">
							<!-- Until the folder lands there is no count to give, and "0 of 0" is not it -->
							{#if ready}{complete} of {builtIn.length}{/if}
						</span>
					</a>
				{/snippet}
			</Sidebar.MenuButton>
		</Sidebar.MenuItem>
		<Sidebar.MenuItem>
			<Sidebar.MenuButton class="text-sm" onclick={takeTour}>Take the tour</Sidebar.MenuButton>
		</Sidebar.MenuItem>
	</Sidebar.Menu>
</Sidebar.Group>
