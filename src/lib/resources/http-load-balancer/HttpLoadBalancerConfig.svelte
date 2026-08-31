<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import * as Form from '$lib/components/ui/form';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import ConfigField from '$lib/components/ConfigField.svelte';
	import type { Config } from './index';

	const { form }: { form: SuperForm<Config> } = $props();
	const { form: formData } = $derived(form);

	const algorithmLabels: Record<Config['algorithm'], string> = {
		'round-robin': 'Round robin',
		random: 'Random'
	};
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
