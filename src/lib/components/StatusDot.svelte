<script lang="ts">
	import { cn } from '$lib/utils';
	import type { ResourceStatus } from '$lib/resources';
	import { STATUS_DOT_CLASS } from '$lib/status';

	// InstanceStatus is a subset of ResourceStatus, so this covers a single instance too
	const {
		status,
		label,
		class: className
	}: {
		status: ResourceStatus;
		// Only where the colour is the sole reading of the status; elsewhere it would be read twice
		label?: string;
		class?: string;
	} = $props();
</script>

<span
	class={cn('size-2 shrink-0 rounded-full', STATUS_DOT_CLASS[status], className)}
	role={label ? 'img' : undefined}
	aria-label={label}
></span>
