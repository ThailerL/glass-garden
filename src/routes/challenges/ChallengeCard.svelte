<script lang="ts">
	import { LoadingButton } from '$lib/components/ui/button';

	const {
		title,
		description,
		stack,
		goals,
		best,
		action,
		onstart
	}: {
		title: string;
		description?: string;
		// Only a built-in has a canvas to describe before the reader has seen it
		stack?: string;
		goals: number;
		best: number;
		action: 'Start' | 'Continue';
		onstart: () => Promise<void>;
	} = $props();
</script>

<article class="flex items-start justify-between gap-4 rounded-xl border bg-card p-4">
	<div class="flex min-w-0 flex-col gap-1">
		<h3 class="font-medium">{title}</h3>
		{#if description}
			<p class="text-sm text-muted-foreground">{description}</p>
		{/if}
		<div class="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
			{#if stack}<span>{stack}</span>{/if}
			<span>Best run: {best} of {goals} goals</span>
		</div>
	</div>
	<!-- Starting one mounts its files and then loads the canvas, so the button owns the wait -->
	<LoadingButton size="sm" onClickPromise={onstart}>{action}</LoadingButton>
</article>
