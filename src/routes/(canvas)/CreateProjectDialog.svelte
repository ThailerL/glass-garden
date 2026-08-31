<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { templates, type TemplateId } from '$lib/templates';
	import { createProject, type Project } from '$lib/projects.svelte';

	let {
		open = $bindable(false),
		onCreated
	}: { open?: boolean; onCreated: (project: Project) => void } = $props();

	const DEFAULT_NAME = 'New project';
	const DEFAULT_TEMPLATE: TemplateId = 'loadBalancedApp';

	let name = $state(DEFAULT_NAME);
	let templateId = $state<TemplateId>(DEFAULT_TEMPLATE);

	// Reopening starts fresh rather than showing whatever was typed last time
	$effect(() => {
		if (open) {
			name = DEFAULT_NAME;
			templateId = DEFAULT_TEMPLATE;
		}
	});

	function create(event: SubmitEvent) {
		event.preventDefault();
		onCreated(createProject(name.trim(), templateId));
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New project</Dialog.Title>
			<Dialog.Description>Each project has its own canvas, files and data.</Dialog.Description>
		</Dialog.Header>

		<form class="grid gap-4" onsubmit={create}>
			<div class="grid gap-2">
				<Label for="project-name">Name</Label>
				<Input id="project-name" bind:value={name} />
			</div>

			<RadioGroup.Root
				value={templateId}
				onValueChange={(value) => (templateId = value as TemplateId)}
			>
				{#each Object.entries(templates) as [id, template] (id)}
					{@const Icon = template.icon}
					<Label
						for="template-{id}"
						class="flex items-center gap-3 rounded-md border p-3 font-normal has-data-checked:border-primary"
					>
						<RadioGroup.Item id="template-{id}" value={id} />
						<Icon class="size-8 shrink-0 text-muted-foreground" />
						<span class="grid gap-1">
							<span class="font-medium">{template.name}</span>
							<span class="text-muted-foreground">{template.description}</span>
						</span>
					</Label>
				{/each}
			</RadioGroup.Root>

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={!name.trim()}>Create</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
