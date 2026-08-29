<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Form from '$lib/components/ui/form';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getContainer, nodeDirectory } from '$lib/container';
	import { connectionUrl } from './connection';

	const { form, nodeId } = $props();
	const { form: formData } = $derived(form);

	const orchestrator = getOrchestrator();
	const status = $derived(orchestrator.getStatus(nodeId));
	// The reservation rather than a live instance, so the address still shows while stopped
	const port = $derived(orchestrator.getReservedPorts(nodeId)[0]);
	const url = $derived(port === undefined ? undefined : connectionUrl(port));

	function clearData() {
		confirmDelete({
			title: 'Clear database data?',
			description:
				'Deletes everything stored in this database. It will start up empty, and whatever connects to it next must recreate the schema.',
			confirm: { text: 'Clear data' },
			onConfirm: async () => {
				const container = await getContainer();
				// force: the data dir does not exist until the database has started once
				await container.fs.rm(`${nodeDirectory(nodeId)}/pgdata`, { recursive: true, force: true });
				toast.success('Cleared database data');
			}
		});
	}
</script>

<Form.Field {form} name="name">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label>Name</Form.Label>
			<Input {...props} bind:value={$formData.name} />
		{/snippet}
	</Form.Control>
	<Form.FieldErrors />
</Form.Field>

<Form.Field {form} name="maxConnections">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label>Max Connections</Form.Label>
			<Input type="number" {...props} bind:value={$formData.maxConnections} />
		{/snippet}
	</Form.Control>
	<Form.Description>Connections past this limit are refused.</Form.Description>
	<Form.FieldErrors />
</Form.Field>

<div class="space-y-2">
	<Label>Connection String</Label>
	{#if url}
		<!-- Not an Input: a textbox invites editing a value that is only there to be read -->
		<p class="rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs break-all select-all">
			{url}
		</p>
	{:else}
		<p class="text-sm text-muted-foreground">Available once the database has started.</p>
	{/if}
</div>

<div class="space-y-2">
	<Label>Data</Label>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<!-- Wrapped because a disabled button emits no pointer events for the tooltip -->
				<div {...props} class="w-fit">
					<Button variant="destructive" disabled={status !== 'stopped'} onclick={clearData}>
						Clear data
					</Button>
				</div>
			{/snippet}
		</Tooltip.Trigger>
		{#if status !== 'stopped'}
			<Tooltip.Content>Stop the database first</Tooltip.Content>
		{/if}
	</Tooltip.Root>
</div>
