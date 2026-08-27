<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LoadingButton as Button, type LoadingButtonProps } from '$lib/components/ui/button';
	import { useRenameCancel } from './rename.svelte.js';

	const cancelState = useRenameCancel();

	type Props = Omit<LoadingButtonProps, 'type' | 'onclick'> & {
		child?: Snippet<[{ cancel: () => void }]>;
	};

	let { ref = $bindable(null), children, variant = 'outline', child, ...rest }: Props = $props();
</script>

{#if child}
	{@render child({ cancel: cancelState.cancel })}
{:else}
	<Button bind:ref type="button" onclick={cancelState.cancel} {variant} {...rest}>
		{#if children}
			{@render children()}
		{:else}
			Cancel
		{/if}
	</Button>
{/if}
