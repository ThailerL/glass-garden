<script lang="ts">
	import { Handle, type NodeProps } from '@xyflow/svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getResourceDefinition } from '$lib/resource-definitions';
	import StatusDot from '$lib/components/StatusDot.svelte';

	const node: NodeProps = $props();

	const orchestrator = getOrchestrator();
	const status = $derived(orchestrator.getStatus(node.id));
	const definition = $derived(getResourceDefinition(node));

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

<StatusDot {status} class="absolute top-1 right-1" />
<span class="block origin-center whitespace-nowrap" use:fitText>
	{node.data.name}
</span>
<definition.icon class="h-full w-full" />
{#each definition.handles as handle (handle.type)}
	<Handle type={handle.type} position={handle.position} />
{/each}
