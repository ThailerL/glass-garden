<script module lang="ts">
	import {
		eventTarget,
		windowsOf,
		type Challenge,
		type Goal,
		type GoalState,
		type ScriptEvent
	} from '$lib/challenge';
	import type { RunEnd, RunPhase } from '$lib/challenge-run.svelte';

	// The author's sentence where there is one: a setting's name is code vocabulary
	export function eventSentence(event: ScriptEvent) {
		if (event.text) return event.text;
		const who = eventTarget(event).name;
		if ('start' in event) return `${who} starts`;
		if ('stop' in event) return `${who} stops`;
		return `${who}'s settings change`;
	}

	export type Row = { at: number; time: string } & (
		| { event: ScriptEvent; goal?: undefined; id?: undefined }
		| { goal: Goal; id: string; event?: undefined }
	);

	// In the order they are judged, which is also the order the marks strip shows them, so the
	// two views of one set of goals never disagree
	export function goalsInOrder({ goals, length }: Challenge): [string, Goal][] {
		return Object.entries(goals).sort(([, a], [, b]) => startOf(a, length) - startOf(b, length));
	}

	const startOf = (goal: Goal, length: number) => {
		const { atStart, judged } = windowsOf(goal, length);
		return atStart ? 0 : Math.min(...judged.map(([from]) => from));
	};

	// One list in run order, so the reader never matches times across two lists
	export function timelineRows(challenge: Challenge): Row[] {
		const { events, length } = challenge;
		const eventRows: Row[] = events.map((event) => ({
			at: event.at,
			time: `${event.at} s`,
			event
		}));
		const goalRows: Row[] = goalsInOrder(challenge).map(([id, goal]) => {
			const { atStart, judged } = windowsOf(goal, length);
			const spans = judged.map(([from, to]) => {
				// A read is taken at a moment, where the two ends of its window meet
				if (from === to) return to >= length ? 'At the end' : `At ${from} s`;
				return to >= length ? `${from} s–end` : `${from}–${to} s`;
			});
			return {
				at: startOf(goal, length),
				// Not "0 s", which on an event row means something that happens then
				time: (atStart ? ['At start', ...spans] : spans).join(', '),
				goal,
				id
			};
		});
		// Sorting is stable and the events went in first, so they keep their place within a second
		const rows = [...eventRows, ...goalRows].sort((a, b) => a.at - b.at);
		// One label covers rows sharing a time, and only an exact repeat: a longer span says more
		return rows.map((row, i) => (row.time === rows[i - 1]?.time ? { ...row, time: '' } : row));
	}

	// Every stretch any goal is judged over, once each, shaded on the bar. A moment shades
	// nothing, since a zero-width band would be a line the bar already has for events
	export function shadedSpans({ goals, length }: Challenge): [number, number][] {
		const spans = Object.values(goals)
			.flatMap((goal) => windowsOf(goal, length).judged)
			.filter(([from, to]) => from !== to);
		return [...new Map(spans.map((span) => [`${span[0]}-${span[1]}`, span])).values()];
	}

	// The mark carries the state, so the line says the one thing it cannot: where a goal broke
	export function stateNote(state: GoalState, failedAt: number | undefined) {
		return state === 'failed' && failedAt !== undefined ? `Failed at ${failedAt} s` : '';
	}

	// Only after a scored run failed the goal: before then a hint would give away the answer
	export function offersHint(goal: Goal, state: GoalState, phase: RunPhase) {
		return !!goal.hint && phase === 'done' && state === 'failed';
	}

	// The run holds a reason, so the reader's sentence is worded here with the rest of the copy
	export function endSentence(end: RunEnd | undefined) {
		if (!end) return '';
		if (end.reason === 'stopped') return 'Stopped before the end, so it was not scored';
		const what = end.reason === 'not-cleared' ? 'could not be cleared' : 'did not start';
		return `${end.nodeName} ${what}, so the run was not scored`;
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
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { toast } from 'svelte-sonner';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { messageOf } from '$lib/errors';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { inspectorState } from '$lib/inspector-state.svelte';
	import { getProject, openProject, resetChallenge } from '$lib/projects.svelte';
	import { SvelteSet } from 'svelte/reactivity';
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
	// The author's standing words to the reader, which the card's description never repeats
	const instructions = project?.challenge?.instructions;

	const rows = timelineRows(challenge);
	const ordered = goalsInOrder(challenge);
	const shaded = shadedSpans(challenge);
	const share = (seconds: number) => `${(seconds / challenge.length) * 100}%`;

	// Hints the reader asked to see. Tied to the phase, not to the Run button, so any other way
	// a run starts clears them too
	const shownHints = new SvelteSet<string>();
	$effect(() => {
		if (run.phase === 'starting') shownHints.clear();
	});

	function openLogs(nodeId: string) {
		inspectorState.tab = 'logs';
		graphState.select(nodeId);
	}

	const metCount = $derived(Object.values(run.goals).filter((state) => state === 'met').length);

	function note(id: string) {
		return stateNote(run.goals[id], run.failedAt[id]);
	}

	function confirmReset() {
		confirmDelete({
			title: 'Reset the challenge?',
			description:
				'The canvas goes back to how the challenge started. Your nodes, settings, code, and data are deleted. Your best run is kept.',
			confirm: { text: 'Reset' },
			onConfirm: async () => {
				try {
					if (!project) throw new Error('this project is no longer in the list');
					// Everything of the old canvas belongs to the page, so the reset lands on a reload
					openProject(resetChallenge(project).id);
				} catch (error) {
					toast.error(`Could not reset the challenge: ${messageOf(error)}`);
				}
			}
		});
	}
</script>

{#snippet status()}
	{#if run.phase === 'starting'}
		Starting everything
	{:else if run.phase === 'running'}
		{Math.floor(run.elapsed)} s of {challenge.length} s
	{:else if run.phase === 'done'}
		Last run: {metCount} of {ordered.length} goals met
	{:else if run.phase === 'ended'}
		{endSentence(run.ended)}
	{:else}
		Get ready, then press Run
	{/if}
{/snippet}

{#snippet startsFresh()}
	{#if !run.active}
		<p class="text-xs text-muted-foreground">
			Each run restarts every node and clears what they have stored.
		</p>
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

{#snippet hint(id: string, goal: Goal)}
	{#if shownHints.has(id)}
		<p class="mt-1 text-xs leading-relaxed">{goal.hint}</p>
	{:else}
		<Button
			variant="link"
			size="xs"
			class="mt-0.5 self-start px-0 text-muted-foreground hover:text-foreground hover:underline"
			onclick={() => shownHints.add(id)}
		>
			Show hint
		</Button>
	{/if}
{/snippet}

{#snippet mark(id: string, title: string | undefined)}
	{@const state = run.goals[id]}
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
		{#each ordered as [id, goal] (id)}
			{@const line = note(id)}
			<li>{@render mark(id, line ? `${goal.title}: ${line}` : goal.title)}</li>
		{/each}
	</ul>
{/snippet}

{#snippet runButton()}
	{#if run.active}
		<Button variant="outline" size="sm" onclick={() => run.stop()}>Stop run</Button>
	{:else}
		<Button size="sm" onclick={() => void run.start()}>Run</Button>
	{/if}
{/snippet}

{#snippet prose(className: string)}
	<div class={className}>
		{#each instructions ?? [] as paragraph, i (i)}
			<p>{paragraph}</p>
		{/each}
	</div>
{/snippet}

{#snippet timeline()}
	<Sidebar.Content class="gap-3 px-3 pb-3 text-sm">
		{#if instructions}
			{@render prose('flex flex-col gap-2 leading-relaxed text-muted-foreground')}
		{/if}
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
						{@const state = run.goals[row.id]}
						{@const line = note(row.id)}
						{@render mark(row.id, undefined)}
						<div class="flex flex-col">
							<span class="leading-snug font-medium">{row.goal.title}</span>
							{#if line}
								<span
									class="text-xs {state === 'failed' ? 'text-foreground' : 'text-muted-foreground'}"
									>{line}</span
								>
							{/if}
							{#if offersHint(row.goal, state, run.phase)}
								{@render hint(row.id, row.goal)}
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
		{@render startsFresh()}
		<!-- The canvas is what a phone has least of, so the words fold away rather than go missing -->
		{#if instructions}
			<Collapsible.Root class="group/instructions">
				<Collapsible.Trigger
					class="flex items-center text-xs text-muted-foreground hover:text-foreground"
				>
					<ChevronRightIcon
						class="mr-1 size-3.5 transition-transform group-data-[state=open]/instructions:rotate-90"
					/>
					What to do
				</Collapsible.Trigger>
				<Collapsible.Content>
					{@render prose('flex flex-col gap-2 pt-1 text-xs leading-relaxed text-muted-foreground')}
				</Collapsible.Content>
			</Collapsible.Root>
		{/if}
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
			<div class="flex shrink-0 gap-1.5">
				<Button
					variant="outline"
					size="icon-sm"
					aria-label="Reset challenge"
					title="Reset challenge"
					disabled={run.active}
					onclick={confirmReset}
				>
					<RotateCcwIcon />
				</Button>
				{@render runButton()}
			</div>
		</Sidebar.Header>
		<div class="flex flex-col gap-3 px-3 pb-3 text-sm">
			<div class="flex items-center justify-between gap-3">
				{@render marks()}
				<span class="text-xs text-muted-foreground">
					Best run: {project?.bestRun?.length ?? 0} of {ordered.length}
				</span>
			</div>
			{@render bar()}
			{@render startsFresh()}
			<!-- The line above already names the node, so the button does not repeat it -->
			{#if run.ended?.reason === 'did-not-start'}
				{@const nodeId = run.ended.nodeId}
				<Button variant="outline" size="sm" class="self-start" onclick={() => openLogs(nodeId)}>
					Open logs
				</Button>
			{/if}
		</div>
		{#if inspector}
			<div class="min-h-0 flex-1 border-t">{@render inspector()}</div>
		{:else}
			{@render timeline()}
		{/if}
	</Sidebar.Root>
{/if}
