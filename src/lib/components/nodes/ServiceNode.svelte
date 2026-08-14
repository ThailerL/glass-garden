<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';

	let { data } = $props();
</script>

{data.name}
<img src="https://www.svgrepo.com/show/474373/cloud-server.svg" alt="Service icon" />
<Handle type="target" position={Position.Left} />
