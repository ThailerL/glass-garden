<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LoadingButton as Button, type LoadingButtonProps } from '$lib/components/ui/button';
	import { useRenameEdit } from './rename.svelte.js';

	const editState = useRenameEdit();

	type Props = Omit<LoadingButtonProps, 'type' | 'onclick'> & {
		child?: Snippet<[{ edit: () => void }]>;
	};

	let { ref = $bindable(null), children, variant = 'outline', child, ...rest }: Props = $props();
</script>

{#if child}
	{@render child({ edit: editState.edit })}
{:else}
	<Button bind:ref type="button" onclick={editState.edit} {variant} {...rest}>
		{#if children}
			{@render children()}
		{:else}
			Edit
		{/if}
	</Button>
{/if}
