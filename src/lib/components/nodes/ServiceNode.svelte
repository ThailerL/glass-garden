<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import ServerIcon from '@lucide/svelte/icons/server';

	const { data } = $props();
</script>

{data.name}
<ServerIcon class="h-full w-full" />
<Handle type="target" position={Position.Left} />
