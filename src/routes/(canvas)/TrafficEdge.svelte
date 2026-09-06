<script lang="ts">
	import { BaseEdge, type EdgeProps } from '@xyflow/svelte';
	import { getBezierPath } from '@xyflow/system';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { FAN_LENGTH, laneOffsets, lanePath } from '$lib/lanes';
	import { TRAVEL_MS, type Flight } from '$lib/traffic.svelte';

	const {
		id,
		target,
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition
	}: EdgeProps = $props();
	const orchestrator = getOrchestrator();

	const statuses = $derived(orchestrator.getInstanceStatuses(target));
	const offsets = $derived(laneOffsets(statuses.length));
	// The trunk stops short of the target when it fans, and the lanes cover the rest
	const splitX = $derived(offsets.length > 0 ? targetX - FAN_LENGTH : targetX);
	const [trunk] = $derived(
		getBezierPath({ sourceX, sourceY, sourcePosition, targetX: splitX, targetY, targetPosition })
	);
	const lanes = $derived(
		offsets.map((offset) => lanePath(splitX, targetY, targetX, targetY + offset))
	);
	const flights = $derived(orchestrator.traffic.flights.filter((flight) => flight.edgeId === id));

	// A hop that named no instance lands at the handle
	function path(flight: Flight) {
		if (lanes.length === 0) return trunk;
		const lane = lanes[flight.lane ?? -1] ?? lanePath(splitX, targetY, targetX, targetY);
		return `${trunk} ${lane}`;
	}
	// A batch is one dot, drawn heavier
	const radius = (count: number) => Math.min(3.5 * Math.sqrt(count), 8);

	// SMIL begins are relative to the document, so an inserted animation is started by hand
	const begin = (node: SVGAnimateMotionElement) => node.beginElement();
</script>

<!-- No arrowhead: the lane's dot is the terminus -->
<BaseEdge {id} path={trunk} />
{#each lanes as lane, i (i)}
	<path d={lane} class="svelte-flow__edge-path lane" class:out={statuses[i] !== 'running'} />
{/each}
{#each flights as flight (flight.id)}
	<!-- Frozen at its end until the store drops it, else it would snap back to the origin -->
	<circle r={radius(flight.count)} class="packet">
		<animateMotion
			path={path(flight)}
			dur="{TRAVEL_MS}ms"
			begin="indefinite"
			fill="freeze"
			calcMode="spline"
			keySplines="0 0 0.2 1"
			keyPoints={flight.reverse ? '1;0' : '0;1'}
			keyTimes="0;1"
			use:begin
		/>
	</circle>
{/each}
