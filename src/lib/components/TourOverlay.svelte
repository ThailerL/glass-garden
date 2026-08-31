<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getResourceDefinition } from '$lib/resources';
	import { inspectorTab } from '$lib/inspector-tab.svelte';
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
		edit: {
			title: 'The code lives here',
			body: 'Open it from Edit Resource Code. Every resource with files you can change has this button.'
		},
		done: {
			title: "That's the whole loop",
			body: 'Every instance is running the same small server file. Open it, change what the page says, and they all pick it up on their next boot.'
		}
	};

	// Said once Run has been pressed, while the instances are still coming up. The step asks
	// for nothing more, so it says so rather than leaving the user hunting for the next thing
	const WAITING = {
		title: 'Starting up',
		body: 'Give the app a moment to start. This will move on as soon as every dot is green.'
	};

	// Replaces the refresh step's opening line once a refresh has landed. Which instance
	// answered is only known inside the page itself, so this points at it rather than
	// naming a port the app never sees
	const REFRESHED = 'Look at the port on the page, it moves on to the next instance every time.';

	const CARD_WIDTH = 300;
	// Between the highlight and the card, and between the card and the window
	const GAP = 14;
	const EDGE = 12;

	function clamp(value: number, min: number, max: number) {
		return Math.min(Math.max(value, min), max);
	}

	type Box = { top: number; left: number; width: number; height: number };

	function same(a: Box | undefined, b: Box | undefined) {
		if (!a || !b) return a === b;
		return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
	}

	// The canvas keeps the selection on the nodes themselves, and the middle steps ask for one
	// node and no more
	const selectedNodeId = $derived.by(() => {
		const selected = graphState.nodes.filter((node) => node.selected);
		return selected.length === 1 ? selected[0].id : undefined;
	});

	const everythingRunning = $derived(
		graphState.nodes.length > 0 &&
			graphState.nodes.every((node) => orchestrator.getStatus(node.id) === 'running')
	);

	// The half of the run step that comes after the press. Stopping again drops out of it,
	// which puts the step back to asking for a press
	const waiting = $derived(
		!everythingRunning &&
			graphState.nodes.some((node) => {
				const status = orchestrator.getStatus(node.id);
				return status === 'starting' || status === 'running';
			})
	);

	const wholeControls = $derived(tour.step === 'run' && waiting);

	// Dimming is there to isolate something worth pressing. The wait after Run has nothing to
	// press, and the closing pointer is advice rather than a step, so both give the canvas back
	const dimmed = $derived(!wholeControls && tour.step !== 'edit');

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
			case 'edit':
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
		return CARD_TEXT[tour.step];
	});

	let target = $state<Box | undefined>();
	// Measured rather than assumed, so the beak stays on the card whatever the text runs to
	let cardHeight = $state(0);

	// Measured every frame rather than on resize: the canvas pans and zooms under the
	// highlight, and the panel the last two steps point at can be dragged wider
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

		const pad = tour.step === 'select' ? 8 : 6;
		const height = target.height + pad * 2;

		// The controls are a rounded pill and a node is a large box; everything else is a
		// small control carrying the app's usual corner
		let radius = 10;
		if (wholeControls) radius = height / 2;
		else if (tour.step === 'select') radius = 16;

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
	const beside = $derived(tour.step === 'refresh' || tour.step === 'edit');

	const card = $derived.by(() => {
		if (!spot) return undefined;

		if (beside) {
			// The edit button sits at the foot of the panel, so the card is held clear of the
			// bottom of the window rather than hanging off it
			const lowest = Math.max(EDGE, window.innerHeight - cardHeight - EDGE);
			const top = clamp(spot.top - 12, EDGE, lowest);
			return {
				top,
				left: Math.max(EDGE, spot.left - GAP - CARD_WIDTH),
				beak: 'right' as const,
				// A highlight taller than the card would otherwise put the beak off its end
				offset: clamp(spot.top + spot.height / 2 - top, 18, Math.max(18, cardHeight - 18))
			};
		}

		const left = clamp(
			spot.left + spot.width / 2 - CARD_WIDTH / 2,
			EDGE,
			window.innerWidth - CARD_WIDTH - EDGE
		);
		return {
			top: spot.top + spot.height + GAP,
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
		if (selectedNodeId === tour.balancerId && inspectorTab.value === 'preview') {
			tour.completed('preview');
		}
	});

	let cardEl = $state<HTMLElement>();

	// The closing pair are notes rather than steps: they wait for nothing, so anything else
	// the user reaches for puts them away — the button the last one points at included,
	// which opens the editor on the very same click
	$effect(() => {
		if (tour.step !== 'done' && tour.step !== 'edit') return;

		const dismiss = (event: PointerEvent) => {
			if (!cardEl?.contains(event.target as Node)) tour.end();
		};

		window.addEventListener('pointerdown', dismiss);
		return () => window.removeEventListener('pointerdown', dismiss);
	});

	const editableNodeId = $derived(
		graphState.nodes.find((node) => getResourceDefinition(node.type).hasEditableFiles)?.id
	);

	// Selecting the resource rather than opening it: the canvas stays put, one thing changes,
	// and the trip to the editor is the reader's own click on a button they have been shown
	function selectAndPointAtCode(nodeId: string) {
		graphState.select(nodeId);
		tour.completed('done');
	}
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
		bind:clientHeight={cardHeight}
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
				Each instance counts on its own. When you create a new project, there is a version that
				shares one view-count in a database.
			</p>
		{/if}

		<div class="flex items-center justify-between gap-3 pt-1">
			<Button variant="ghost" size="sm" onclick={() => tour.end()}>
				{stepNumber > 0 ? 'Skip tour' : 'Close'}
			</Button>
			<!-- The refresh step is the one the user can repeat, so it needs a way out of its own -->
			{#if tour.step === 'refresh'}
				<Button size="sm" onclick={() => tour.completed('refresh')}>Done</Button>
			{:else if tour.step === 'done' && editableNodeId}
				<Button size="sm" onclick={() => selectAndPointAtCode(editableNodeId)}>
					Show me the code
				</Button>
			{/if}
		</div>
	</div>
{/if}
