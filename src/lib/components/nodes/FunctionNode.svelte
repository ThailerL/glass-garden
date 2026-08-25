<script lang="ts">
	import FunctionIcon from '@lucide/svelte/icons/square-function';
	import { Handle, Position } from '@xyflow/svelte';
	import NodeTemplate from './NodeTemplate.svelte';

	const { data } = $props();
</script>

<NodeTemplate {data} Icon={FunctionIcon} />
<Handle type="target" position={Position.Left} />
