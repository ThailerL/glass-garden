<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { toast } from 'svelte-sonner';
	import { messageOf } from '$lib/errors';
	import { goalIds } from '$lib/challenge';
	import { startingResources, suggestedResources } from '$lib/challenge-stack';
	import type { ChallengeDocument } from '$lib/project-document';
	import {
		challengeCatalogue,
		loadCatalogue,
		type CatalogueEntry
	} from '$lib/challenge-catalogue.svelte';
	import { importProject, openProject } from '$lib/projects.svelte';
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import Workspace from '$lib/components/Workspace.svelte';
	import ChallengeCard from './ChallengeCard.svelte';

	loadCatalogue();
	const { builtIn, imported, unread, ready } = $derived(challengeCatalogue());

	// What a card draws of the system, from the canvas the challenge starts on rather than from
	// anything an author wrote out. An imported project may predate its challenge being stored
	function describe(document: ChallengeDocument | undefined) {
		if (!document) return {};
		return {
			starting: startingResources(document),
			suggested: suggestedResources(document)
		};
	}

	// Continue where the reader left off, or start a fresh copy. One decision, so the card and a
	// link from outside open a challenge the same way
	function open({ entry, started }: CatalogueEntry) {
		try {
			openProject(started ? started.id : importProject(entry.document, { builtIn: entry.id }).id);
		} catch (error) {
			toast.error(`Could not start the challenge: ${messageOf(error)}`);
		}
	}

	// A link from outside names the challenge it is about, so the reader lands in it rather than
	// on the list with the card to find again. Acted on once, since opening reloads the page
	let followed = false;
	$effect(() => {
		const id = page.url.searchParams.get('start');
		if (!ready || followed || !id) return;
		followed = true;
		// Dropped before the canvas opens, so pressing Back lands on the list rather than here
		replaceState(resolve('/challenges'), page.state);
		const found = builtIn.find((one) => one.entry.id === id);
		if (found) open(found);
		else toast.error(`There is no challenge called "${id}" in this list.`);
	});
</script>

<svelte:head><title>Challenges · Glass Garden</title></svelte:head>

<!-- No canvas here, so the sidebar carries no resource palette -->
{#snippet leftSidebar()}
	<AppSidebar />
{/snippet}

<!-- Gives the compact layout's menu button a bar of its own, clear of the page's own links -->
{#snippet topBar()}
	<span class="text-sm font-medium">Challenges</span>
{/snippet}

{#snippet mainContent()}
	<div class="h-full overflow-y-auto">
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
							{...describe(project.challenge)}
							goals={project.challenge ? goalIds(project.challenge).length : 0}
							best={project.bestRun?.length ?? 0}
							action="Continue"
							onstart={async () => openProject(project.id)}
						/>
					{/each}
				</section>
			{/if}

			<section class="flex flex-col gap-2">
				<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Built in
				</h2>
				{#each builtIn as one (one.entry.id)}
					<ChallengeCard
						title={one.title}
						goals={one.goals}
						best={one.best}
						description={one.entry.document.description}
						{...describe(one.entry.document)}
						action={one.started ? 'Continue' : 'Start'}
						onstart={async () => open(one)}
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
{/snippet}

<Workspace {leftSidebar} {mainContent} {topBar} />
