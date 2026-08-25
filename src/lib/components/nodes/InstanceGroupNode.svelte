<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import ServerIcon from '@lucide/svelte/icons/server';
	import NodeTemplate from './NodeTemplate.svelte';

	const node: NodeProps = $props();
</script>

<NodeTemplate {node} Icon={ServerIcon} />
<Handle type="target" position={Position.Left} />
