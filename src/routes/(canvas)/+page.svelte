<script>
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import './index.css';

	import Canvas from './Canvas.svelte';
</script>

<SvelteFlowProvider>
	<Canvas />
</SvelteFlowProvider>
