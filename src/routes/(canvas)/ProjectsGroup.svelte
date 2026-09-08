<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ImportIcon from '@lucide/svelte/icons/import';
	import { toast } from 'svelte-sonner';
	import { messageOf } from '$lib/errors';
	import { getGraphState } from '$lib/graph-state.svelte';
	import {
		deleteProject,
		ensureProject,
		exportProject,
		importProject,
		listProjects,
		setLastProjectId,
		type Project
	} from '$lib/projects.svelte';
	import CreateProjectDialog from './CreateProjectDialog.svelte';
	import ProjectMenuItem from './ProjectMenuItem.svelte';

	const graphState = getGraphState();
	const projects = $derived(listProjects());

	let creating = $state(false);
	let fileInput = $state<HTMLInputElement>();

	async function download(project: Project) {
		try {
			const url = URL.createObjectURL(
				new Blob([await exportProject(project)], { type: 'application/json' })
			);
			const link = Object.assign(document.createElement('a'), {
				href: url,
				download: `${project.name}.gg.json`
			});
			link.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			toast.error(`Could not export the project: ${messageOf(error)}`);
		}
	}

	async function importPicked(input: HTMLInputElement) {
		const file = input.files?.[0];
		// Cleared so picking the same file again fires change again
		input.value = '';
		if (!file) return;
		try {
			openProject((await importProject(await file.text())).id);
		} catch (error) {
			toast.error(messageOf(error));
		}
	}

	// Reloads rather than switching in place: a switch tears the container down and boots a new
	// one, and on Chromium the preview relay does not survive that, so the page loses its control
	// channel to the region while VM-side callers still reach it
	function openProject(id: string) {
		if (id === graphState.projectId) return;
		setLastProjectId(id);
		location.reload();
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
		<Sidebar.GroupAction
			class="top-1.5 right-9"
			title="Import project"
			onclick={() => fileInput?.click()}
		>
			<ImportIcon />
		</Sidebar.GroupAction>
		<input
			bind:this={fileInput}
			type="file"
			accept=".json,application/json"
			hidden
			onchange={(event) => importPicked(event.currentTarget)}
		/>

		<Collapsible.Content>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each projects as project (project.id)}
						<ProjectMenuItem
							{project}
							active={project.id === graphState.projectId}
							onOpen={() => openProject(project.id)}
							onExport={() => download(project)}
							onDelete={() => confirmDeleteProject(project)}
						/>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Collapsible.Content>
	</Sidebar.Group>
</Collapsible.Root>

<CreateProjectDialog bind:open={creating} onCreated={(project) => openProject(project.id)} />
