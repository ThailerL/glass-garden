<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ImportIcon from '@lucide/svelte/icons/import';
	import { downloadDocument, offerFileImport, shareDocument } from '$lib/document-transfer';
	import { getGraphState } from '$lib/graph-state.svelte';
	import {
		deleteProject,
		ensureProject,
		exportProject,
		listProjects,
		openProject,
		type Project
	} from '$lib/projects.svelte';
	import CreateProjectDialog from './CreateProjectDialog.svelte';
	import ProjectMenuItem from './ProjectMenuItem.svelte';

	// The project on screen, if the canvas is what's showing: the catalogue highlights no row
	const { active }: { active?: string } = $props();

	const graphState = getGraphState();
	const projects = $derived(listProjects());

	let creating = $state(false);

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
		<Sidebar.GroupAction
			class="top-1.5 right-9"
			title="Import project or challenge"
			onclick={offerFileImport}
		>
			<ImportIcon />
		</Sidebar.GroupAction>

		<Collapsible.Content>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each projects as project (project.id)}
						<ProjectMenuItem
							{project}
							active={project.id === active}
							onOpen={() => project.id !== active && openProject(project.id)}
							onExport={() => downloadDocument(exportProject(project))}
							onShare={() => shareDocument(exportProject(project))}
							onDelete={() => confirmDeleteProject(project)}
						/>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Collapsible.Content>
	</Sidebar.Group>
</Collapsible.Root>

<CreateProjectDialog bind:open={creating} onCreated={(project) => openProject(project.id)} />
