<script lang="ts" module>
	// In a module so these are shared by all instances of the tab and survive switching between nodes
	let eventsOnly = $state(false);
	let showTimes = $state(false);
</script>

<script lang="ts">
	import { Toggle } from '$lib/components/ui/toggle';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import type { LogSource, Stream } from '$lib/resource-log.svelte';
	import StreamSelect from '$lib/components/StreamSelect.svelte';
	const { nodeId }: { nodeId: string } = $props();
	const orchestrator = getOrchestrator();

	const output = $derived(orchestrator.getOutput(nodeId));
	const events = $derived(orchestrator.getEvents(nodeId));

	const levelClass = {
		info: 'bg-blue-500',
		warning: 'bg-amber-500',
		error: 'bg-red-500'
	};

	const timeFormat = new Intl.DateTimeFormat(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});

	let selected = $state<Stream['source'] | 'all'>('all');

	// Whether a source is worth naming at all, which is a question about the node rather
	// than about what the select is currently showing
	const streams = $derived(orchestrator.getStreams(nodeId));
	const labelled = $derived(streams.length > 1);

	function label(source: LogSource) {
		if (source === 'resource') return 'resource';
		return streams.find((stream) => stream.source === source)?.label ?? String(source);
	}

	// Both lists arrive oldest-first, so the sort only has to settle where they meet. Log
	// lines win a tie because an event is a remark about output that has already been printed
	const merged = $derived([...output, ...events].sort((a, b) => a.time - b.time));

	// Events are in order on their own, so wanting only those is answered without a merge
	const entries = $derived(eventsOnly ? events : merged);

	// The resource's own entries stay in every view: an install that failed is the reason an
	// instance never printed anything
	const shown = $derived(
		selected === 'all'
			? entries
			: entries.filter((entry) => entry.source === selected || entry.source === 'resource')
	);

	// How close to the end still counts as being at the end
	const SLACK = 8;

	let scroller = $state<HTMLElement>();
	let pinned = true;

	function toEnd() {
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	}

	function trackPinned(event: { currentTarget: HTMLElement }) {
		const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
		pinned = scrollHeight - scrollTop - clientHeight < SLACK;
	}

	// Follows new entries only while the reader is already at the end, so scrolling back to
	// read isn't yanked away by the next line
	$effect(() => {
		if (shown.length && pinned) toEnd();
	});

	// The tab stays mounted and is merely hidden, and a hidden element has no scroll height
	// to move through, so anything appended while it was closed left the view at the top.
	// Catching up on visibility also covers opening the tab for the first time
	$effect(() => {
		if (!scroller) return;
		const visible = new IntersectionObserver(([entry]) => {
			if (!entry.isIntersecting) return;
			pinned = true;
			toEnd();
		});
		visible.observe(scroller);
		return () => visible.disconnect();
	});
</script>

<div class="flex h-full min-h-0 flex-col gap-2">
	<div class="flex gap-2">
		<Toggle variant="outline" class="shrink-0" title="Show timestamps" bind:pressed={showTimes}>
			<ClockIcon />
		</Toggle>
		<Toggle variant="outline" class="shrink-0" bind:pressed={eventsOnly}>Events only</Toggle>
		<StreamSelect {nodeId} bind:selected />
	</div>

	<!-- Kept mounted even when empty, so the observer below attaches once and stays -->
	<ul
		bind:this={scroller}
		onscroll={trackPinned}
		class="min-h-0 flex-1 overflow-y-auto p-1 font-mono text-xs"
	>
		{#each shown as entry (entry)}
			<li class="flex gap-2">
				<span
					class={[
						'mt-1 size-1.5 shrink-0 rounded-full',
						entry.kind === 'event' && levelClass[entry.level]
					]}
				></span>
				{#if showTimes}
					<span class="shrink-0 text-muted-foreground tabular-nums">
						{timeFormat.format(entry.time)}
					</span>
				{/if}
				{#if labelled && selected === 'all'}
					<span class="shrink-0 text-muted-foreground tabular-nums">
						{label(entry.source)}
					</span>
				{/if}
				<!-- Only printed output keeps its own spacing; an event is a sentence -->
				<span class={['wrap-anywhere', entry.kind === 'output' && 'whitespace-pre-wrap']}>
					{entry.text}
				</span>
			</li>
		{:else}
			<li class="p-1 font-sans text-sm text-muted-foreground">
				{eventsOnly ? 'No events yet' : 'No output yet'}
			</li>
		{/each}
	</ul>
</div>
