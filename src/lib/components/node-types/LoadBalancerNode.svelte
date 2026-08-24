<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import NetworkIcon from '@lucide/svelte/icons/network';

	const { data } = $props();
</script>

<span class="text-nowrap">{data.name}</span>
<NetworkIcon class="h-full w-full rotate-270" />
<Handle type="target" position={Position.Left} />
<Handle type="source" position={Position.Right} />
