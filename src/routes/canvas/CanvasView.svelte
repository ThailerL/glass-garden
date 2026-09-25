<script>
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { appView, challengeAddress } from '$lib/app-view';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getProject } from '$lib/projects.svelte';
	import './index.css';

	import Canvas from './Canvas.svelte';

	const builtIn = getProject(getGraphState().projectId)?.builtIn;

	// The one writer of the address. Only a built-in's id means anything outside this browser
	afterNavigate(({ to }) => {
		// Also fires for a navigation away, before this unmounts
		if (!to || appView(to.url).name !== 'canvas') return;
		const unknown = page.data.unknownChallenge;
		if (unknown) toast.error(`There is no challenge called "${unknown}" here.`);
		const path = resolve(builtIn ? challengeAddress(builtIn) : '/');
		if (location.pathname + location.search !== path) replaceState(path, page.state);
	});
</script>

<SvelteFlowProvider>
	<Canvas />
</SvelteFlowProvider>
