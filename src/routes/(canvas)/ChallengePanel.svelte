<script module lang="ts">
	import {
		eventTarget,
		windowsOf,
		type Challenge,
		type Goal,
		type GoalState,
		type ScriptEvent
	} from '$lib/challenge';

	// The author's sentence where there is one: a setting's name is code vocabulary
	export function eventSentence(event: ScriptEvent) {
		if (event.text) return event.text;
		const who = eventTarget(event).name;
		if ('start' in event) return `${who} starts`;
		if ('stop' in event) return `${who} stops`;
		return `${who}'s settings change`;
	}

	export type Row = { at: number; time: string } & (
		{ event: ScriptEvent; goal?: undefined } | { goal: Goal; event?: undefined }
	);

	// One list in run order, so the reader never matches times across two lists
	export function timelineRows({ events, goals, length }: Challenge): Row[] {
		const eventRows: Row[] = events.map((event) => ({
			at: event.at,
			time: `${event.at} s`,
			event
		}));
		const goalRows: Row[] = goals.map((goal) => {
			const { atStart, judged } = windowsOf(goal, length);
			const spans = judged.map(([from, to]) =>
				to >= length ? `${from} s–end` : `${from}–${to} s`
			);
			return {
				at: atStart ? 0 : Math.min(...judged.map(([from]) => from)),
				// Not "0 s", which on an event row means something that happens then
				time: (atStart ? ['At start', ...spans] : spans).join(', '),
				goal
			};
		});
		// Sorting is stable and the events went in first, so they keep their place within a second
		const rows = [...eventRows, ...goalRows].sort((a, b) => a.at - b.at);
		// One label covers rows sharing a time, and only an exact repeat: a longer span says more
		return rows.map((row, i) => (row.time === rows[i - 1]?.time ? { ...row, time: '' } : row));
	}

	// Every stretch any goal is judged over, once each, shaded on the bar
	export function shadedSpans({ goals, length }: Challenge): [number, number][] {
		const spans = goals.flatMap((goal) => windowsOf(goal, length).judged);
		return [...new Map(spans.map((span) => [`${span[0]}-${span[1]}`, span])).values()];
	}

	// The mark carries the state, so the line says the one thing it cannot: where a goal broke
	export function stateNote(state: GoalState, failedAt: number | undefined) {
		return state === 'failed' && failedAt !== undefined ? `Failed at ${failedAt} s` : '';
	}

	const MARK: Record<GoalState, string> = { waiting: '', judging: '•', met: '✓', failed: '✕' };
	const MARK_CLASS: Record<GoalState, string> = {
		waiting: 'border-border',
		judging: 'border-sky-600 text-sky-600 dark:border-sky-400 dark:text-sky-400',
		met: 'border-primary bg-primary text-primary-foreground',
		failed: 'border-destructive text-destructive'
	};
</script>

<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getProject } from '$lib/projects.svelte';
	import type { ChallengeRun } from '$lib/challenge-run.svelte';

	// It heads the sidebar with an inspector under it; on a phone it floats over the canvas
	const {
		run,
		placement,
		inspector
	}: { run: ChallengeRun; placement: 'sidebar' | 'floating'; inspector?: Snippet } = $props();

	const graphState = getGraphState();
	// The record, for its name and best run; the run carries the challenge as it plays
	const project = getProject(graphState.projectId);
	const challenge = untrack(() => run.challenge);

	const rows = timelineRows(challenge);
	const shaded = shadedSpans(challenge);
	const share = (seconds: number) => `${(seconds / challenge.length) * 100}%`;

	const metCount = $derived(Object.values(run.goals).filter((state) => state === 'met').length);

	function note(goal: Goal) {
		return stateNote(run.goals[goal.id], run.failedAt[goal.id]);
	}
</script>

{#snippet status()}
	{#if run.phase === 'starting'}
		Starting everything
	{:else if run.phase === 'running'}
		{Math.floor(run.elapsed)} s of {challenge.length} s
	{:else if run.phase === 'done'}
		Last run: {metCount} of {challenge.goals.length} goals met
	{:else if run.phase === 'ended'}
		{run.endedBecause}
	{:else}
		Get ready, then press Run
	{/if}
{/snippet}

{#snippet bar()}
	<div class="relative h-2 rounded bg-muted">
		{#each shaded as [from, to] (`${from}-${to}`)}
			<div
				class="absolute inset-y-0 bg-sky-500/30"
				style="left: {share(from)}; width: {share(to - from)}"
			></div>
		{/each}
		<div
			class="absolute inset-y-0 left-0 rounded bg-primary/70"
			style="width: {share(run.elapsed)}"
		></div>
		{#each challenge.events as event, i (i)}
			<div
				class="absolute -top-0.75 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
				style="left: {share(event.at)}"
				title="{event.at} s · {eventSentence(event)}"
			></div>
		{/each}
	</div>
{/snippet}

{#snippet mark(goal: Goal, title: string | undefined)}
	{@const state = run.goals[goal.id]}
	<span
		class="flex size-5 items-center justify-center rounded-full border-2 text-xs font-bold
		       {MARK_CLASS[state]}"
		{title}
	>
		{MARK[state]}
	</span>
{/snippet}

{#snippet marks()}
	<ul class="flex gap-1.5" aria-label="Goals">
		{#each challenge.goals as goal (goal.id)}
			{@const line = note(goal)}
			<li>{@render mark(goal, line ? `${goal.title}: ${line}` : goal.title)}</li>
		{/each}
	</ul>
{/snippet}

{#snippet runButton()}
	{#if run.active}
		<Button variant="outline" size="sm" onclick={() => run.stop()}>Stop run</Button>
	{:else}
		<Button size="sm" onclick={() => run.start()}>Run</Button>
	{/if}
{/snippet}

{#snippet timeline()}
	<Sidebar.Content class="gap-3 px-3 pb-3 text-sm">
		<!-- One grid, so the time column is as wide as its longest span on every row -->
		<ol class="grid grid-cols-[max-content_1.25rem_minmax(0,1fr)] gap-x-2 gap-y-2.5">
			{#each rows as row, i (i)}
				<!-- Rows the clock has not reached yet wait dimmed; before a run, all read evenly -->
				<li
					class="col-span-3 grid grid-cols-subgrid items-start
					       {run.phase !== 'idle' && run.elapsed < row.at ? 'opacity-55' : ''}"
				>
					<span class="pt-0.5 text-xs text-muted-foreground tabular-nums">{row.time}</span>
					{#if row.goal}
						{@const state = run.goals[row.goal.id]}
						{@const line = note(row.goal)}
						{@render mark(row.goal, undefined)}
						<div class="flex flex-col">
							<span class="leading-snug font-medium">{row.goal.title}</span>
							{#if line}
								<span
									class="text-xs {state === 'failed' ? 'text-foreground' : 'text-muted-foreground'}"
									>{line}</span
								>
							{/if}
						</div>
					{:else}
						<!-- The icon of the button that does the same thing by hand -->
						{@const EventIcon =
							'start' in row.event ? PlayIcon : 'stop' in row.event ? SquareIcon : SlidersIcon}
						<span class="flex size-5 items-center justify-center text-muted-foreground">
							<EventIcon class="size-3.5" />
						</span>
						<span class="leading-snug">{eventSentence(row.event)}</span>
					{/if}
				</li>
			{/each}
		</ol>
	</Sidebar.Content>
{/snippet}

{#if placement === 'floating'}
	<section
		aria-label="Challenge"
		class="absolute top-16 right-4 z-10 flex w-64 flex-col gap-2 rounded-xl border bg-background
		       p-3 text-sm shadow-lg"
	>
		<div class="flex items-center justify-between gap-2">
			<span class="min-w-0 truncate text-muted-foreground">{@render status()}</span>
			{@render runButton()}
		</div>
		{@render bar()}
		{@render marks()}
	</section>
{:else}
	<!-- Selecting a node swaps only what is under the header, so Run and the marks never move -->
	<Sidebar.Root side="right" collapsible="none" class="w-full!" aria-label="Challenge">
		<Sidebar.Header class="flex-row items-start justify-between gap-3 px-3 pt-3 pb-2">
			<div class="flex min-w-0 flex-col gap-0.5">
				<div class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Challenge
				</div>
				<div class="truncate font-medium">{project?.name}</div>
				<div class="text-sm text-muted-foreground">{@render status()}</div>
			</div>
			{@render runButton()}
		</Sidebar.Header>
		<div class="flex flex-col gap-3 px-3 pb-3 text-sm">
			<div class="flex items-center justify-between gap-3">
				{@render marks()}
				<span class="text-xs text-muted-foreground">
					Best run: {project?.bestRun?.length ?? 0} of {challenge.goals.length}
				</span>
			</div>
			{@render bar()}
		</div>
		{#if inspector}
			<div class="min-h-0 flex-1 border-t">{@render inspector()}</div>
		{:else}
			{@render timeline()}
		{/if}
	</Sidebar.Root>
{/if}
