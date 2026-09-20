<script lang="ts" generics="T extends Record<string, unknown>, U extends FormPath<T>">
	// One labelled choice in a resource's config form. ConfigField's sibling for a setting whose
	// schema is an enum, so a challenge's fixed settings read the same way here as there
	import type { FormPath, SuperForm } from 'sveltekit-superforms';
	import * as Form from '$lib/components/ui/form';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import ReadOnlyValue from '$lib/components/ReadOnlyValue.svelte';
	import { getFixedSettings } from '$lib/challenge-settings';

	let {
		form,
		name,
		label,
		options,
		value = $bindable()
	}: {
		form: SuperForm<T>;
		name: U;
		label: string;
		// Value to the words for it, which the read-only rendering shows in place of the choice
		options: Record<string, string>;
		value: string;
	} = $props();

	const fixed = getFixedSettings();
</script>

{#if fixed(name)}
	<ReadOnlyValue {label} value={options[value] ?? value} />
{:else}
	<Form.Fieldset {form} {name}>
		<Form.Legend>{label}</Form.Legend>
		<RadioGroup.Root bind:value {name}>
			{#each Object.entries(options) as [option, optionLabel] (option)}
				<div class="flex items-center gap-3">
					<Form.Control>
						{#snippet children({ props })}
							<RadioGroup.Item value={option} {...props} />
							<Form.Label class="font-normal">{optionLabel}</Form.Label>
						{/snippet}
					</Form.Control>
				</div>
			{/each}
		</RadioGroup.Root>
		<Form.FieldErrors />
	</Form.Fieldset>
{/if}
