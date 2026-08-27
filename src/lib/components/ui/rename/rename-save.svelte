<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LoadingButton as Button, type LoadingButtonProps } from '$lib/components/ui/button';
	import { useRenameSave } from './rename.svelte.js';

	const saveState = useRenameSave();

	type Props = Omit<LoadingButtonProps, 'type' | 'onclick'> & {
		child?: Snippet<[{ save: () => void }]>;
	};

	let { ref = $bindable(null), children, variant = 'default', child, ...rest }: Props = $props();
</script>

{#if child}
	{@render child({ save: saveState.save })}
{:else}
	<Button bind:ref type="button" onclick={saveState.save} {variant} {...rest}>
		{#if children}
			{@render children()}
		{:else}
			Save
		{/if}
	</Button>
{/if}
