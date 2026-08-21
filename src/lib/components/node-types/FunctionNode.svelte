<script lang="ts">
	import FunctionIcon from '@lucide/svelte/icons/square-function';
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	const { data }: NodeProps = $props();
</script>

<span class="text-nowrap">{data.name}</span>
<FunctionIcon class="h-full w-full" />
<Handle type="target" position={Position.Left} />
