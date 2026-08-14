<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	let { data }: NodeProps = $props();
</script>

{data.name}
<img
	src="https://symbols.getvecta.com/stencil_9/36_lambda-function.b2a8536bdb.svg"
	alt="Function icon"
/>
<Handle type="target" position={Position.Left} />
