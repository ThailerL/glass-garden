<script lang="ts">
	import { toast } from 'svelte-sonner';
	import type { SuperForm } from 'sveltekit-superforms';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import ConfigField from '$lib/components/ConfigField.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getContainer, nodeDirectory } from '$lib/container';
	import { messageOf } from '$lib/errors';
	import { connectionUrl } from './connection';
	import type { Config } from './index';

	const { form, nodeId }: { form: SuperForm<Config>; nodeId: string } = $props();
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
				try {
					const container = await getContainer();
					// force: the data dir does not exist until the database has started once
					await container.fs.rm(`${nodeDirectory(nodeId)}/pgdata`, {
						recursive: true,
						force: true
					});
				} catch (e) {
					toast.error(`Could not clear the database data: ${messageOf(e)}`);
					return;
				}
				toast.success('Cleared database data');
			}
		});
	}
</script>

<ConfigField {form} name="name" label="Name" bind:value={$formData.name} />

<ConfigField
	{form}
	name="maxConnections"
	label="Max Connections"
	type="number"
	description="Connections past this limit are refused."
	bind:value={$formData.maxConnections}
/>

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
