<script>
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import './index.css';

	import App from './App.svelte';
	import DnDProvider from '$lib/components/DnDProvider.svelte';
</script>

<SvelteFlowProvider>
	<DnDProvider>
		<App />
	</DnDProvider>
</SvelteFlowProvider>
