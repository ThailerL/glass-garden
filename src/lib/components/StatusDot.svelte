<script lang="ts">
	import { cn } from '$lib/utils';

	// InstanceStatus is a subset of ResourceStatus, so this covers a single instance too
	const { status, class: className }: { status: ResourceStatus; class?: string } = $props();

	const dotClass: Record<ResourceStatus, string> = {
		starting: 'bg-blue-500 animate-pulse',
		running: 'bg-green-500',
		stopping: 'bg-blue-500 animate-pulse',
		stopped: 'bg-muted-foreground',
		degraded: 'bg-amber-500',
		crashed: 'bg-red-500'
	};
</script>

<span class={cn('size-2 shrink-0 rounded-full', dotClass[status], className)}></span>
