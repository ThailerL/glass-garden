<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getResourceDefinition } from '$lib/resources';
	import { inspectorState } from '$lib/inspector-state.svelte';
	import { tour, NUMBERED_STEPS, type TourStep } from '$lib/tour.svelte';

	const graphState = getGraphState();
	const orchestrator = getOrchestrator();

	const CARD_TEXT: Record<TourStep, { title: string; body: string }> = {
		run: {
			title: 'Start everything up',
			body: 'Press Run. The load balancer and every instance of your app start together, and the dots turn green once they are up.'
		},
		select: {
			title: 'Open the load balancer',
			body: 'Click it on the canvas. Anything you put on the canvas opens a panel on the right, where you can see how it is set up.'
		},
		preview: {
			title: 'See what it serves',
			body: 'Switch to the Preview tab to load the page the load balancer hands back.'
		},
		refresh: {
			title: 'Refresh, and watch the port change',
			body: 'Every refresh is sent to a different instance of your app. The port on the page tells you which one answered.'
		},
		app: {
			title: 'Open your app',
			body: 'Click it on the canvas. Every refresh you just did went to one of its instances.'
		},
		metrics: {
			title: 'See where the refreshes landed',
			body: 'Switch to the Metrics tab to see what each instance did with them.'
		},
		done: {
			title: "That's the whole loop",
			body: 'Every instance is running the same small server file. Open it from Edit Resource Code, change what the page says, and they all pick it up on their next boot.'
		}
	};

	const WAITING = {
		title: 'Starting up',
		body: 'Give the app a moment to start. This will move on as soon as every dot is green.'
	};

	// Replaces the refresh step's opening line once the user has refreshed
	const REFRESHED = 'Look at the port on the page, it moves on to the next instance every time.';

	// Replaces the metrics step's opening line once its charts are on screen
	const CHARTS_OPEN =
		'Each instance counted the requests it answered on its own. The chart shows how they were shared out, and "all" adds them back up to the total refreshes you did.';

	const CARD_WIDTH = 300;
	const HIGHLIGHT_GAP = 14;
	const WINDOW_EDGE_GAP = 12;

	function clamp(value: number, min: number, max: number) {
		return Math.min(Math.max(value, min), max);
	}

	type Box = { top: number; left: number; width: number; height: number };

	function same(a: Box | undefined, b: Box | undefined) {
		if (!a || !b) return a === b;
		return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
	}

	const selectedNodeId = $derived.by(() => {
		const selected = graphState.nodes.filter((node) => node.selected);
		return selected.length === 1 ? selected[0].id : undefined;
	});

	// The app the balancer sits in front of, which is also what the closing step points at
	const editableNodeId = $derived(
		graphState.nodes.find((node) => getResourceDefinition(node.type).hasEditableFiles)?.id
	);

	// The metrics step asks for two things, so it moves on from the canvas once it has the first
	const appOpen = $derived(!!editableNodeId && selectedNodeId === editableNodeId);

	// The step's last phase: what it asked for is on screen, and the card waits to be dismissed
	const chartsOpen = $derived(
		tour.step === 'metrics' && appOpen && inspectorState.tab === 'metrics'
	);

	// Both steps that point at a node on the canvas
	const onNode = $derived(tour.step === 'select' || tour.step === 'app');

	const everythingRunning = $derived(
		graphState.nodes.length > 0 &&
			graphState.nodes.every((node) => orchestrator.getStatus(node.id) === 'running')
	);

	// The half of the run step that comes after the press
	const waiting = $derived(
		!everythingRunning &&
			graphState.nodes.some((node) => {
				const status = orchestrator.getStatus(node.id);
				return status === 'starting' || status === 'running';
			})
	);

	const wholeControls = $derived(tour.step === 'run' && waiting);
	const dimmed = $derived(!wholeControls && tour.step !== 'done');

	// Both halves of the tour widen once the user has acted: the thing they pressed stays
	// lit, and what it changed comes into the light beside it
	const selector = $derived.by(() => {
		switch (tour.step) {
			case 'run':
				return wholeControls ? '[data-tour="controls"]' : '[data-tour="run"]';
			// Svelte Flow tags each node wrapper with its id, and the wrapper is the whole box
			// worth highlighting rather than the contents rendered inside it
			case 'select':
				return `.svelte-flow__node[data-id="${tour.balancerId}"]`;
			case 'preview':
				return '[data-tour="preview-tab"]';
			case 'refresh':
				return tour.refreshed ? '[data-tour="preview-panel"]' : '[data-tour="refresh"]';
			case 'app':
				return `.svelte-flow__node[data-id="${editableNodeId}"]`;
			// Widens from the tab to the charts it opens, the way refresh widens to the page
			case 'metrics':
				return chartsOpen ? '[data-tour="metrics-charts"]' : '[data-tour="metrics-tab"]';
			case 'done':
				return '[data-tour="edit-code"]';
			default:
				return undefined;
		}
	});

	const cardText = $derived.by(() => {
		if (!tour.step) return undefined;
		if (wholeControls) return WAITING;
		if (tour.step === 'refresh' && tour.refreshed) {
			return { ...CARD_TEXT.refresh, body: REFRESHED };
		}
		if (tour.step === 'metrics' && chartsOpen) {
			return { ...CARD_TEXT.metrics, body: CHARTS_OPEN };
		}
		return CARD_TEXT[tour.step];
	});

	let target = $state<Box | undefined>();
	let measuredCardHeight = $state(0);

	// Measure overlay every frame
	$effect(() => {
		if (!selector) {
			target = undefined;
			return;
		}

		// Compared against a plain local, so measuring never depends on what it last wrote
		let measured: Box | undefined;
		let frame = requestAnimationFrame(function measure() {
			const rect = document.querySelector(selector)?.getBoundingClientRect();
			// A tab the reader has switched away from leaves its panel in the page, hidden and
			// measuring nothing, which is as good as absent for something meant to be pointed at
			const next =
				rect && rect.width > 0 && rect.height > 0
					? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
					: undefined;

			if (!same(measured, next)) {
				measured = next;
				target = next;
			}
			frame = requestAnimationFrame(measure);
		});

		return () => cancelAnimationFrame(frame);
	});

	const spot = $derived.by(() => {
		if (!target) return undefined;

		const pad = onNode ? 8 : 6;
		const height = target.height + pad * 2;

		// The controls are a rounded pill and a node is a large box; everything else is a
		// small control carrying the app's usual corner
		let radius = 10;
		if (wholeControls) radius = height / 2;
		else if (onNode) radius = 16;

		return {
			top: target.top - pad,
			left: target.left - pad,
			width: target.width + pad * 2,
			height,
			radius
		};
	});

	// Both of these sit in the narrow panel on the right, which leaves no room for a card
	// above or below them and plenty of it alongside
	const beside = $derived(tour.step === 'refresh' || tour.step === 'done' || chartsOpen);

	const card = $derived.by(() => {
		if (!spot) return undefined;

		if (beside) {
			// The edit button sits at the foot of the panel, so the card is held clear of the
			// bottom of the window rather than hanging off it
			const lowest = Math.max(
				WINDOW_EDGE_GAP,
				window.innerHeight - measuredCardHeight - WINDOW_EDGE_GAP
			);
			const top = clamp(spot.top - 12, WINDOW_EDGE_GAP, lowest);
			return {
				top,
				left: Math.max(WINDOW_EDGE_GAP, spot.left - HIGHLIGHT_GAP - CARD_WIDTH),
				beak: 'right' as const,
				// A highlight taller than the card would otherwise put the beak off its end
				offset: clamp(spot.top + spot.height / 2 - top, 18, Math.max(18, measuredCardHeight - 18))
			};
		}

		const left = clamp(
			spot.left + spot.width / 2 - CARD_WIDTH / 2,
			WINDOW_EDGE_GAP,
			window.innerWidth - CARD_WIDTH - WINDOW_EDGE_GAP
		);
		return {
			top: spot.top + spot.height + HIGHLIGHT_GAP,
			left,
			beak: 'up' as const,
			offset: clamp(spot.left + spot.width / 2 - left, 18, CARD_WIDTH - 18)
		};
	});

	// A step that points at something waits for it: with the panel it lives in closed the card
	// holds off, and comes back on its own once the reader is looking at it again
	const showCard = $derived(!!cardText && (!!card || !selector));

	const stepNumber = $derived(tour.step ? NUMBERED_STEPS.indexOf(tour.step) + 1 : 0);

	// Each step ends on the app reaching the state it asked for. completed() ignores a step
	// the tour has already left, so a condition that stays true afterwards costs nothing
	$effect(() => {
		if (everythingRunning) tour.completed('run');
		if (selectedNodeId === tour.balancerId) tour.completed('select');
		if (selectedNodeId === tour.balancerId && inspectorState.tab === 'preview') {
			tour.completed('preview');
		}
		if (appOpen) tour.completed('app');
		// The metrics step is not here: opening the tab is what it asked for, but the reader
		// needs a moment with the charts, so it ends on its own button
	});

	let cardEl = $state<HTMLElement>();

	// The closing card is a note rather than a step, so it closes if the user clicks away
	$effect(() => {
		if (tour.step !== 'done') return;

		const dismiss = (event: PointerEvent) => {
			if (!cardEl?.contains(event.target as Node)) tour.end();
		};

		window.addEventListener('pointerdown', dismiss);
		return () => window.removeEventListener('pointerdown', dismiss);
	});
</script>

{#if showCard && cardText}
	{#if spot}
		<!-- The shadow is what dims the app; the element itself is the hole, and stays out of the
		way so the control underneath is still the one the user clicks. Undimmed, the ring has to
		carry the emphasis on its own, and a white one would be invisible against the app -->
		<div
			class="pointer-events-none fixed z-60 outline-2 {dimmed
				? 'shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] outline-white/90'
				: 'outline-primary'}"
			style="top: {spot.top}px; left: {spot.left}px; width: {spot.width}px;
             height: {spot.height}px; border-radius: {spot.radius}px"
		></div>
	{/if}

	<!-- A step's card sits against whatever it points at. The closing pair have nothing to sit
	against, so they take the middle of the window and let the canvas come back around them -->
	<div
		bind:this={cardEl}
		bind:clientHeight={measuredCardHeight}
		class="fixed z-61 flex flex-col gap-2 rounded-lg border bg-popover p-4
           text-popover-foreground shadow-lg {card
			? 'w-75'
			: 'top-1/2 left-1/2 w-85 -translate-x-1/2 -translate-y-1/2'}"
		style={card ? `top: ${card.top}px; left: ${card.left}px` : ''}
	>
		{#if card?.beak === 'up'}
			<div
				class="absolute -top-1.75 size-3 rotate-45 border-t border-l bg-popover"
				style="left: {card.offset}px"
			></div>
		{:else if card}
			<div
				class="absolute -right-1.75 size-3 rotate-45 border-t border-r bg-popover"
				style="top: {card.offset}px"
			></div>
		{/if}

		{#if stepNumber > 0}
			<div class="text-xs font-medium text-muted-foreground">
				Step {stepNumber} of {NUMBERED_STEPS.length}
			</div>
		{/if}
		<h3 class="font-semibold">{cardText.title}</h3>
		<p class="text-[13px] leading-relaxed text-muted-foreground">{cardText.body}</p>

		{#if tour.step === 'done'}
			<p class="text-xs leading-relaxed text-muted-foreground">
				Click <PlusIcon class="inline size-3.5 align-text-bottom" /> next to Projects in the sidebar to
				start a new canvas from a template.
			</p>
		{/if}

		<div class="flex items-center justify-between gap-3 pt-1">
			<Button variant="ghost" size="sm" onclick={() => tour.end()}>
				{stepNumber > 0 ? 'Skip tour' : 'Close'}
			</Button>
			{#if tour.step === 'refresh' && tour.refreshed}
				<Button size="sm" onclick={() => tour.completed('refresh')}>Next</Button>
			{:else if tour.step === 'metrics' && chartsOpen}
				<Button size="sm" onclick={() => tour.completed('metrics')}>Done</Button>
			{/if}
		</div>
	</div>
{/if}
