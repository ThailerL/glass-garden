<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getResourceDefinition } from '$lib/resources';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import { nodeConfig } from '$lib/graph-state.svelte';

	const node: NodeProps = $props();
	const name = $derived(nodeConfig<{ name: string }>(node).name);

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

<div class="absolute top-1 right-1 flex items-center gap-1">
	{#if configured > 1}
		<span class="text-[0.5rem] leading-none text-muted-foreground">{up}/{configured}</span>
	{/if}
	<StatusDot {status} />
</div>
<span class="block origin-center whitespace-nowrap" use:fitText>
	{name}
</span>
<definition.icon class="h-full w-full" />
{#if definition.provides.length > 0}
	<Handle type="target" position={Position.Left} />
{/if}
{#if definition.consumes.length > 0}
	<Handle type="source" position={Position.Right} />
{/if}
