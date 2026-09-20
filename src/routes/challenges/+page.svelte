<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { toast } from 'svelte-sonner';
	import { messageOf } from '$lib/errors';
	import { type BuiltInChallenge } from '$lib/challenges';
	import { challengeCatalogue, loadCatalogue } from '$lib/challenge-catalogue.svelte';
	import { importProject, openProject } from '$lib/projects.svelte';
	import ChallengeCard from './ChallengeCard.svelte';

	loadCatalogue();
	const { builtIn, imported, unread } = $derived(challengeCatalogue());

	async function start(entry: BuiltInChallenge) {
		try {
			openProject((await importProject(entry.document, entry.id)).id);
		} catch (error) {
			toast.error(`Could not start the challenge: ${messageOf(error)}`);
		}
	}
</script>

<svelte:head><title>Challenges · Glass Garden</title></svelte:head>

<div class="min-h-0 flex-1 overflow-y-auto">
	<div class="mx-auto flex max-w-3xl flex-col gap-6 p-6">
		<div class="flex flex-col gap-1">
			<a
				href={resolve('/')}
				class="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeftIcon class="size-4" />
				Back to canvas
			</a>
			<h1 class="text-2xl font-semibold">Challenges</h1>
			<p class="text-sm text-muted-foreground">
				Each one gives you a canvas and a run to survive. Get the system ready, then press Run and
				watch it score what happens.
			</p>
		</div>

		{#if imported.length > 0}
			<section class="flex flex-col gap-2">
				<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Imported
				</h2>
				{#each imported as project (project.id)}
					<ChallengeCard
						title={project.challenge?.title ?? project.name}
						description={project.challenge?.description}
						goals={project.challenge?.goals.length ?? 0}
						best={project.bestRun?.length ?? 0}
						action="Continue"
						onstart={async () => openProject(project.id)}
					/>
				{/each}
			</section>
		{/if}

		<section class="flex flex-col gap-2">
			<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Built in</h2>
			{#each builtIn as { entry, title, goals, best, started } (entry.id)}
				<ChallengeCard
					{title}
					{goals}
					{best}
					description={entry.description}
					stack={entry.stack}
					action={started ? 'Continue' : 'Start'}
					onstart={async () => (started ? openProject(started.id) : start(entry))}
				/>
			{/each}
			{#each unread as { file, problem } (file)}
				<p class="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
					<span class="font-medium text-foreground">{file}</span> could not be read: {problem}
				</p>
			{/each}
		</section>
	</div>
</div>
