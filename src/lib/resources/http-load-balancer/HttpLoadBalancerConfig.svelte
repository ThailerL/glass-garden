<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as Form from '$lib/components/ui/form';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Separator } from '$lib/components/ui/separator';
	import ConfigField from '$lib/components/ConfigField.svelte';
	import { hasAdvancedError, type Config } from './index';

	const { form }: { form: SuperForm<Config> } = $props();
	const { form: formData, errors } = $derived(form);

	const algorithmLabels: Record<Config['algorithm'], string> = {
		'round-robin': 'Round robin',
		random: 'Random'
	};

	let open = $state(false);
	// Every failed save replaces the error set, so a fresh attempt reopens this
	$effect(() => {
		if (hasAdvancedError($errors)) open = true;
	});
</script>

<ConfigField {form} name="name" label="Name" bind:value={$formData.name} />
<Form.Fieldset {form} name="algorithm">
	<Form.Legend>Algorithm</Form.Legend>
	<RadioGroup.Root bind:value={$formData.algorithm} name="algorithm">
		{#each Object.entries(algorithmLabels) as [value, label] (value)}
			<div class="flex items-center gap-3">
				<Form.Control>
					{#snippet children({ props })}
						<RadioGroup.Item {value} {...props} />
						<Form.Label class="font-normal">{label}</Form.Label>
					{/snippet}
				</Form.Control>
			</div>
		{/each}
	</RadioGroup.Root>
	<Form.FieldErrors />
</Form.Fieldset>

<Separator />
<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Health checks</h3>

<ConfigField
	{form}
	name="healthCheckPath"
	label="Path"
	description="Requested on every target. Answer it from something the app depends on and a broken instance leaves rotation on its own."
	bind:value={$formData.healthCheckPath}
/>
<ConfigField
	{form}
	name="healthCheckInterval"
	label="Interval (seconds)"
	type="number"
	description="How often each target is checked. Checks carry the user agent ELB-HealthChecker/2.0, so an app can tell them apart from real traffic."
	bind:value={$formData.healthCheckInterval}
/>

<Collapsible.Root bind:open class="group/advanced space-y-4">
	<Collapsible.Trigger
		class="flex items-center text-sm font-medium hover:text-muted-foreground"
		type="button"
	>
		<ChevronRightIcon
			class="mr-1 size-4 transition-transform group-data-[state=open]/advanced:rotate-90"
		/>
		Advanced health check settings
	</Collapsible.Trigger>
	<Collapsible.Content class="space-y-4">
		<ConfigField
			{form}
			name="healthCheckTimeout"
			label="Timeout (seconds)"
			type="number"
			description="How long a target has to answer before the check counts as a failure. Must be less than the interval."
			bind:value={$formData.healthCheckTimeout}
		/>
		<ConfigField
			{form}
			name="unhealthyThreshold"
			label="Unhealthy threshold"
			type="number"
			description="Failures in a row before a target stops receiving traffic. While every target is unhealthy they all keep receiving it, because a total failure is more often the check's fault than the fleet's."
			bind:value={$formData.unhealthyThreshold}
		/>
		<ConfigField
			{form}
			name="healthyThreshold"
			label="Healthy threshold"
			type="number"
			description="Passes in a row before a target returns to rotation. A target that has just appeared joins on its first pass instead."
			bind:value={$formData.healthyThreshold}
		/>
		<ConfigField
			{form}
			name="matcher"
			label="Success codes"
			description="Status codes that count as a pass. Single codes and ranges, separated by commas."
			bind:value={$formData.matcher}
		/>
	</Collapsible.Content>
</Collapsible.Root>
