<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ImportIcon from '@lucide/svelte/icons/import';
	import { challengeAddress } from '$lib/app-view';
	import { goalIds } from '$lib/challenge';
	import { startingResources, suggestedResources } from '$lib/challenge-stack';
	import type { ChallengeDocument } from '$lib/project-document';
	import { challengeCatalogue, loadCatalogue } from '$lib/challenge-catalogue.svelte';
	import { downloadDocument, offerFileImport, shareDocument } from '$lib/document-transfer';
	import { deleteProject, openProject, type ChallengeProject } from '$lib/projects.svelte';
	import { Button } from '$lib/components/ui/button';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import Workspace from '$lib/components/Workspace.svelte';
	import ChallengeCard from './ChallengeCard.svelte';

	loadCatalogue();
	const { builtIn, imported, unread } = $derived(challengeCatalogue());

	// What a card draws of the system, from the canvas the challenge starts on rather than from
	// anything an author wrote out
	function describe(document: ChallengeDocument) {
		return {
			starting: startingResources(document),
			suggested: suggestedResources(document)
		};
	}

	function confirmDeleteChallenge(project: ChallengeProject) {
		confirmDelete({
			title: `Delete "${project.challenge.title}"?`,
			description: 'Your runs on it are deleted too, and cannot be recovered.',
			onConfirm: async () => deleteProject(project.id)
		});
	}
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
				<div class="flex items-center justify-between gap-4">
					<h1 class="text-2xl font-semibold">Challenges</h1>
					<Button variant="outline" size="sm" onclick={offerFileImport}>
						<ImportIcon />
						Import
					</Button>
				</div>
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
							title={project.challenge.title}
							description={project.challenge.description}
							{...describe(project.challenge)}
							goals={goalIds(project.challenge).length}
							best={project.bestRun?.length ?? 0}
							action="Continue"
							onstart={async () => openProject(project.id)}
							actions={{
								onExport: () => downloadDocument(project.challenge),
								onShare: () => shareDocument(project.challenge),
								onDelete: () => confirmDeleteChallenge(project)
							}}
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
						onstart={async () => location.assign(resolve(challengeAddress(one.entry.id)))}
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
