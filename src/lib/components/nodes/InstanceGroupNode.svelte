<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import ServerIcon from '@lucide/svelte/icons/server';
	import NodeTemplate from './NodeTemplate.svelte';

	const { data } = $props();
</script>

<NodeTemplate {data} Icon={ServerIcon} />
<Handle type="target" position={Position.Left} />
