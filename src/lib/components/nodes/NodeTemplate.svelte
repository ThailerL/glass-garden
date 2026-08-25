<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';

	const {
		data,
		Icon
	}: {
		data: { status: ResourceStatus; config: Record<string, unknown> };
		Icon: LucideIcon;
	} = $props();

	const statusDotClass: Record<ResourceStatus, string> = {
		'not started': 'bg-muted-foreground',
		starting: 'bg-blue-500 animate-pulse',
		running: 'bg-green-500',
		stopping: 'bg-blue-500 animate-pulse',
		stopped: 'bg-muted-foreground '
	};

	function fitText(node: HTMLSpanElement) {
		const container = node.parentElement as HTMLElement;

		const resize = () => {
			const style = getComputedStyle(container);
			const available =
				container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
			const scale = node.scrollWidth > 0 ? Math.min(1, available / node.scrollWidth) : 1;
			node.style.transform = `scale(${scale})`;
		};

		const observer = new ResizeObserver(resize);
		observer.observe(container);
		observer.observe(node);

		return {
			destroy() {
				observer.disconnect();
			}
		};
	}
</script>

<span class="absolute top-1 right-1 size-2 rounded-full {statusDotClass[data.status]}"></span>
<span class="block origin-center whitespace-nowrap" use:fitText>
	{data.config.name}
</span>
<Icon class="h-full w-full" />
