<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import NodeTemplate from './NodeTemplate.svelte';

	const { data } = $props();
</script>

<NodeTemplate {data} Icon={NetworkIcon} />
<Handle type="target" position={Position.Left} />
<Handle type="source" position={Position.Right} />
