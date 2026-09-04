<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getResourceDefinition } from '$lib/resources';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import { nodeName } from '$lib/graph-state.svelte';
	import { STATUS_TEXT } from '$lib/status';

	const node: NodeProps = $props();
	const name = $derived(nodeName(node));

	const orchestrator = getOrchestrator();
	const status = $derived(orchestrator.getStatus(node.id));
	const definition = $derived(getResourceDefinition(node.type));

	const up = $derived(orchestrator.getUpCount(node.id));
	const configured = $derived(orchestrator.getConfiguredCount(node.id));

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

<div class="absolute top-1.5 right-2 flex items-center gap-1">
	{#if configured > 1}
		<span
			class="text-[0.6875rem] leading-none text-muted-foreground tabular-nums"
			title="Instances running out of the configured count"
		>
			{up}/{configured}
		</span>
	{/if}
	<StatusDot {status} label={STATUS_TEXT[status]} />
</div>
<definition.icon class="size-10 shrink-0 text-resource-icon" />
<span
	class="block origin-center overflow-visible pt-1.5 text-[0.8125rem] leading-tight
	       font-medium whitespace-nowrap"
	use:fitText
>
	{name}
</span>
{#if definition.provides.length > 0}
	<Handle type="target" position={Position.Left} />
{/if}
{#if definition.consumes.length > 0}
	<Handle type="source" position={Position.Right} />
{/if}
