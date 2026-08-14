<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';

	let { data } = $props();
</script>

{data.name}
<img
	src="https://symbols.getvecta.com/stencil_9/39_load-balancer.af7d4495ba.svg"
	alt="Load balancer icon"
/>
<Handle type="target" position={Position.Left} />
{#each data.targetGroups as targetGroup, i (targetGroup.id)}
	<Handle
		type="source"
		position={Position.Right}
		id={targetGroup.id}
		style="top: {((i + 1) * 100) / (data.targetGroups.length + 1)}%"
	/>
{/each}
