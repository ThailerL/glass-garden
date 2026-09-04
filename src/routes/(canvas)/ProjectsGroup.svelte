<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import {
		deleteProject,
		ensureProject,
		listProjects,
		setLastProjectId,
		type Project
	} from '$lib/projects.svelte';
	import CreateProjectDialog from './CreateProjectDialog.svelte';
	import ProjectMenuItem from './ProjectMenuItem.svelte';

	const graphState = getGraphState();
	const orchestrator = getOrchestrator();
	const projects = $derived(listProjects());

	let creating = $state(false);

	function openProject(id: string) {
		if (id === graphState.projectId) return;
		setLastProjectId(id);
		orchestrator.reset();
		graphState.switchTo(id);
		// A template-built project reserved nothing yet; a stored one should already hold
		orchestrator.reconcileAllReservations();
	}

	function confirmDeleteProject(project: Project) {
		confirmDelete({
			title: `Delete "${project.name}"?`,
			description: 'Everything on its canvas is deleted too, and cannot be recovered.',
			onConfirm: async () => {
				const wasOpen = project.id === graphState.projectId;
				deleteProject(project.id);
				// The canvas on screen just went, so it has to land somewhere that still exists
				if (wasOpen) openProject(ensureProject().id);
			}
		});
	}
</script>

<Collapsible.Root open class="group/collapsible">
	<Sidebar.Group class="py-0">
		<Sidebar.GroupLabel class="text-xs font-semibold tracking-wide uppercase">
			{#snippet child({ props })}
				<Collapsible.Trigger {...props}>
					<ChevronRightIcon
						class="mr-1 transition-transform group-data-[state=open]/collapsible:rotate-90"
					/>
					Projects
				</Collapsible.Trigger>
			{/snippet}
		</Sidebar.GroupLabel>

		<Sidebar.GroupAction class="top-1.5" title="New project" onclick={() => (creating = true)}>
			<PlusIcon />
		</Sidebar.GroupAction>

		<Collapsible.Content>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each projects as project (project.id)}
						<ProjectMenuItem
							{project}
							active={project.id === graphState.projectId}
							onOpen={() => openProject(project.id)}
							onDelete={() => confirmDeleteProject(project)}
						/>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Collapsible.Content>
	</Sidebar.Group>
</Collapsible.Root>

<CreateProjectDialog bind:open={creating} onCreated={(project) => openProject(project.id)} />
