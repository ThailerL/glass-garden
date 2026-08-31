<script
	lang="ts"
	generics="T extends Record<string, unknown>, U extends FormPath<T>, V extends string | number"
>
	// One labelled input in a resource's config form, wired to the field its schema names.
	// Every resource has at least the name field, so this is the shape a new one starts from
	import type { FormPath, SuperForm } from 'sveltekit-superforms';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';

	let {
		form,
		name,
		label,
		type = 'text',
		description,
		value = $bindable()
	}: {
		form: SuperForm<T>;
		name: U;
		label: string;
		type?: 'text' | 'number';
		// Said under the field rather than in the label, for a constraint the name can't carry
		description?: string;
		value: V;
	} = $props();
</script>

<Form.Field {form} {name}>
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label>{label}</Form.Label>
			<Input {...props} {type} bind:value />
		{/snippet}
	</Form.Control>
	{#if description}
		<Form.Description>{description}</Form.Description>
	{/if}
	<Form.FieldErrors />
</Form.Field>
