<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import NodeTemplate from './NodeTemplate.svelte';

	const node: NodeProps = $props();
</script>

<NodeTemplate {node} Icon={NetworkIcon} />
<Handle type="target" position={Position.Left} />
<Handle type="source" position={Position.Right} />
