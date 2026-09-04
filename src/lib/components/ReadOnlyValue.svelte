<script lang="ts">
	// A labelled value the user can read and copy but not change - a name fixed at creation,
	// an address derived from a reserved port. Text rather than a disabled input: an input
	// takes a cursor and looks editable, so it reads as a field that refuses typing.
	import type { Snippet } from 'svelte';
	import { Label } from '$lib/components/ui/label';

	let {
		label,
		value,
		description,
		empty,
		listEmpty,
		children
	}: {
		label: string;
		// Undefined while the value does not exist yet, which `empty` explains
		value?: string | number;
		description?: string;
		empty?: string;
		// For a value that is more than one line, or part of which is prose rather than data
		children?: Snippet;
		// Whether children rendered nothing this time - a snippet is always passed, so the
		// component cannot look inside it to tell
		listEmpty?: boolean;
	} = $props();

	const isEmpty = $derived(children ? (listEmpty ?? false) : value === undefined || value === '');
</script>

<div class="space-y-2">
	<Label>{label}</Label>
	{#if isEmpty}
		<p class="text-sm text-muted-foreground">{empty}</p>
	{:else}
		<p class="rounded-md border bg-muted px-2.5 py-1.5 font-mono text-xs break-all select-all">
			{#if children}{@render children()}{:else}{value}{/if}
		</p>
		{#if description}
			<p class="text-sm text-muted-foreground">{description}</p>
		{/if}
	{/if}
</div>
