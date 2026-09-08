<script lang="ts">
	import '@xterm/xterm/css/xterm.css';
	import { shellSessions, type Shell } from '$lib/shell-sessions.svelte';

	// Every shell keeps a host, hidden or not; becoming visible is what opens and measures it
	function host(node: HTMLDivElement, shell: Shell) {
		const visibility = new IntersectionObserver(([entry]) => {
			if (entry.isIntersecting) shell.reveal(node);
		});
		visibility.observe(node);

		const size = new ResizeObserver(([entry]) => {
			if (entry.contentRect.width && entry.contentRect.height) shell.fit();
		});
		size.observe(node);

		// The terminal element goes with this host when it is destroyed and survives detached,
		// so the next view to reveal this shell just moves it back in
		return {
			destroy() {
				visibility.disconnect();
				size.disconnect();
			}
		};
	}
</script>

<div class="relative h-full w-full bg-black">
	{#each shellSessions.shells as shell (shell.id)}
		<div
			class="absolute inset-0"
			hidden={shell.id !== shellSessions.activeId}
			use:host={shell}
		></div>
	{/each}
</div>
