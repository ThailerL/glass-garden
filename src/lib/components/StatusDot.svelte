<script lang="ts">
	import { cn } from '$lib/utils';
	import type { ResourceStatus } from '$lib/resources';
	import { STATUS_DOT_CLASS } from '$lib/status';

	// InstanceStatus is a subset of ResourceStatus, so this covers a single instance too
	const { status, class: className }: { status: ResourceStatus; class?: string } = $props();
</script>

<span class={cn('size-2 shrink-0 rounded-full', STATUS_DOT_CLASS[status], className)}></span>
