<script>
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import './index.css';

	import App from './App.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
</script>

<SvelteFlowProvider>
	<Sidebar.Provider>
		<App />
	</Sidebar.Provider>
</SvelteFlowProvider>
