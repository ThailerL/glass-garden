<script>
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import './index.css';

	import App from './App.svelte';
	import DnDProvider from '$lib/components/DnDProvider.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
</script>

<SvelteFlowProvider>
	<DnDProvider>
		<Sidebar.Provider>
			<App />
		</Sidebar.Provider>
	</DnDProvider>
</SvelteFlowProvider>
