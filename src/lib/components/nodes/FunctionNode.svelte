<script lang="ts">
	import FunctionIcon from '@lucide/svelte/icons/square-function';
	import { Handle, Position } from '@xyflow/svelte';
	const { data } = $props();
</script>

<span class="text-nowrap">{data.config.name}</span>
<FunctionIcon class="h-full w-full" />
<Handle type="target" position={Position.Left} />
