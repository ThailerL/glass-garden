<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';
	import type { NodeProps } from '@xyflow/svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';

	const { node, Icon }: { node: NodeProps; Icon: LucideIcon } = $props();

	const orchestrator = getOrchestrator();
	const status = $derived(orchestrator.getStatus(node.id));

	const statusDotClass: Record<ResourceStatus, string> = {
		starting: 'bg-blue-500 animate-pulse',
		running: 'bg-green-500',
		stopping: 'bg-blue-500 animate-pulse',
		stopped: 'bg-muted-foreground',
		degraded: 'bg-amber-500',
		crashed: 'bg-red-500'
	};

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

<span class="absolute top-1 right-1 size-2 rounded-full {statusDotClass[status]}"></span>
<span class="block origin-center whitespace-nowrap" use:fitText>
	{node.data.name}
</span>
<Icon class="h-full w-full" />
