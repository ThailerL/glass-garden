<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as Rename from '$lib/components/ui/rename';
	import { renameProject, type Project } from '$lib/projects.svelte';

	const {
		project,
		active,
		onOpen,
		onDelete
	}: {
		project: Project;
		active: boolean;
		onOpen: () => void;
		onDelete: () => void;
	} = $props();

	let mode = $state<'edit' | 'view'>('view');
</script>

<Sidebar.MenuItem>
	<Rename.Provider>
		<ContextMenu.Root>
			<ContextMenu.Trigger>
				<Sidebar.MenuButton
					class="text-base"
					isActive={active}
					onclick={() => {
						// The rename input sits inside this button, so editing must not switch project
						if (mode === 'view') onOpen();
					}}
				>
					<Rename.Root
						this="span"
						bind:mode
						value={project.name}
						blurBehavior="exit"
						textClass="block truncate"
						validate={(value) => value.trim().length > 0}
						onSave={(value) => renameProject(project.id, value.trim())}
					/>
				</Sidebar.MenuButton>
			</ContextMenu.Trigger>
			<ContextMenu.Content>
				<Rename.Edit>
					{#snippet child({ edit })}
						<ContextMenu.Item onSelect={edit}>Rename</ContextMenu.Item>
					{/snippet}
				</Rename.Edit>
				<ContextMenu.Item onSelect={onDelete}>Delete</ContextMenu.Item>
			</ContextMenu.Content>
		</ContextMenu.Root>
	</Rename.Provider>
</Sidebar.MenuItem>
