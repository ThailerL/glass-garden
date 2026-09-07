<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getResourceDefinition } from '$lib/resources';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import { nodeChart, nodeName } from '$lib/graph-state.svelte';
	import { STATUS_TEXT } from '$lib/status';
	import { fans } from '$lib/lanes';
	import NodeChart from './NodeChart.svelte';
	import NodeGauge from './NodeGauge.svelte';

	const node: NodeProps = $props();
	const name = $derived(nodeName(node));
	const chart = $derived(nodeChart(node));

	const orchestrator = getOrchestrator();
	const status = $derived(orchestrator.getStatus(node.id));
	const definition = $derived(getResourceDefinition(node.type));

	// Instances show as dots on the left border, where the edge's lanes land
	const statuses = $derived(orchestrator.getInstanceStatuses(node.id));
	const fanned = $derived(fans(statuses.length));
	const level = $derived(orchestrator.traffic.levels[node.id]);

	function fitText(el: HTMLSpanElement) {
		const container = el.parentElement as HTMLElement;

		const resize = () => {
			const style = getComputedStyle(container);
			const available =
				container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
			const scale = el.scrollWidth > 0 ? Math.min(1, available / el.scrollWidth) : 1;
			el.style.transform = `scale(${scale})`;
		};

		const observer = new ResizeObserver(resize);
		observer.observe(container);
		observer.observe(el);

		return {
			destroy() {
				observer.disconnect();
			}
		};
	}
</script>

<StatusDot {status} label={STATUS_TEXT[status]} class="absolute top-1.5 right-2" />
{#if fanned}
	<!-- Decoration: the handle beneath is the whole left side -->
	<div class="pointer-events-none absolute top-1/2 -left-1 flex -translate-y-1/2 flex-col gap-1">
		{#each statuses as dotStatus, i (i)}
			<StatusDot status={dotStatus} label={STATUS_TEXT[dotStatus]} />
		{/each}
	</div>
{/if}
<definition.icon class="size-10 shrink-0 text-resource-icon" />
<span
	class="block origin-center overflow-visible pt-1.5 text-[0.8125rem] leading-tight
	       font-medium whitespace-nowrap"
	use:fitText
>
	{name}
</span>
{#if level}
	<NodeGauge {level} label={definition.gaugeLabel} />
{/if}
{#if chart}
	<!-- Hung below the card so pinning a chart does not move the handles -->
	<div
		class="absolute top-full left-1/2 mt-2 w-44 -translate-x-1/2 space-y-1 rounded-md border
		       bg-card px-2 py-1.5 text-left shadow-sm"
	>
		<NodeChart nodeId={node.id} type={node.type} name={chart} />
	</div>
{/if}
{#if definition.provides.length > 0}
	<Handle type="target" position={Position.Left} class={fanned ? 'strip' : undefined} />
{/if}
{#if definition.consumes.length > 0}
	<Handle type="source" position={Position.Right} />
{/if}
