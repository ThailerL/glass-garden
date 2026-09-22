<script lang="ts">
	import type { Snippet } from 'svelte';
	import { version } from '$app/environment';
	import { asset } from '$app/paths';
	import { page } from '$app/state';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { embedded, mainAppUrl } from '$lib/embed';
	import { getGraphState } from '$lib/graph-state.svelte';
	import ProjectsGroup from './ProjectsGroup.svelte';
	import FooterMenu from './FooterMenu.svelte';

	// The canvas passes its palette here; a view with nothing to drag onto passes none
	const { resources }: { resources?: Snippet } = $props();

	const graphState = getGraphState();
	// A project stays loaded wherever you are, so only the canvas highlights its row
	const onCanvas = $derived(page.route.id === '/(canvas)');
</script>

<Sidebar.Root collapsible="none" class="w-full!">
	<Sidebar.Header class="flex-row items-center gap-2 px-3 pt-3 pb-1">
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		{#if embedded}
			<a
				href={mainAppUrl('')}
				target="_blank"
				rel="noreferrer"
				class="flex min-w-0 items-center gap-2 hover:text-muted-foreground"
			>
				<img src={asset('/favicon.svg')} alt="" class="size-6 shrink-0" />
				<span class="truncate font-semibold tracking-tight">Glass Garden</span>
			</a>
		{:else}
			<img src={asset('/favicon.svg')} alt="" class="size-6 shrink-0" />
			<span class="truncate font-semibold tracking-tight">Glass Garden</span>
			<a
				href="https://github.com/ThailerL/glass-garden/releases/tag/v{version}"
				target="_blank"
				rel="noreferrer"
				title="Release notes for this version"
				class="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums hover:text-foreground"
			>
				v{version}
			</a>
			<a
				href="https://github.com/ThailerL/glass-garden"
				target="_blank"
				rel="noreferrer"
				title="Glass Garden on GitHub"
				class="shrink-0 text-muted-foreground hover:text-foreground"
			>
				<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class="size-4">
					<path
						d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"
					/>
				</svg>
				<span class="sr-only">Glass Garden on GitHub</span>
			</a>
		{/if}
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</Sidebar.Header>
	<Sidebar.Content class="gap-0 pt-2">
		{#if !embedded}
			<ProjectsGroup active={onCanvas ? graphState.projectId : undefined} />
			{#if resources}<Sidebar.Separator class="my-2" />{/if}
		{/if}
		{@render resources?.()}
	</Sidebar.Content>
	{#if !embedded}
		<Sidebar.Footer class="border-t border-sidebar-border px-0 py-2">
			<FooterMenu />
		</Sidebar.Footer>
	{/if}
</Sidebar.Root>
