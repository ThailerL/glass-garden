<script lang="ts">
	import { LoadingButton } from '$lib/components/ui/button';
	import { getResourceDefinition, type ResourceType } from '$lib/resources';

	const {
		title,
		description,
		starting = [],
		suggested = [],
		goals,
		best,
		action,
		onstart
	}: {
		title: string;
		description?: string;
		// Only a built-in has a canvas to describe before the reader has seen it
		starting?: ResourceType[];
		suggested?: ResourceType[];
		goals: number;
		best: number;
		action: 'Start' | 'Continue';
		onstart: () => Promise<void>;
	} = $props();
</script>

{#snippet icons(types: ResourceType[])}
	{#each types as type (type)}
		{@const definition = getResourceDefinition(type)}
		<definition.icon class="size-4" title={definition.name} />
	{/each}
{/snippet}

<!-- Stretched rather than top-aligned, so the button and the best run sit at the two ends of
     the card's own height -->
<article class="flex justify-between gap-4 rounded-xl border bg-card p-4">
	<div class="flex min-w-0 flex-col gap-1">
		<h3 class="font-medium">{title}</h3>
		{#if description}
			<p class="text-sm text-muted-foreground">{description}</p>
		{/if}
		<!-- What the challenge is about, in the icons the palette and the canvas already use. The
		     phrase is the joint rather than a label: what follows it is the reader's to add, which
		     a symbol between the two groups would leave them to guess -->
		<div class="mt-0.5 flex items-center gap-1.5 text-resource-icon">
			{@render icons(starting)}
			{#if suggested.length > 0}
				<span class="mx-0.5 text-xs whitespace-nowrap text-muted-foreground">
					usually solved with
				</span>
				{@render icons(suggested)}
			{/if}
		</div>
	</div>
	<div class="flex shrink-0 flex-col items-end justify-between gap-4">
		<!-- Starting one mounts its files and then loads the canvas, so the button owns the wait -->
		<LoadingButton size="sm" onClickPromise={onstart}>{action}</LoadingButton>
		<span class="text-xs whitespace-nowrap text-muted-foreground">
			Best run: {best} of {goals} goals
		</span>
	</div>
</article>
