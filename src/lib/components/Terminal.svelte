<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Xterm, XtermAddon } from '@battlefieldduck/xterm-svelte';
	import type {
		ITerminalOptions,
		ITerminalInitOnlyOptions,
		Terminal
	} from '@battlefieldduck/xterm-svelte';
	import type { FitAddon } from '@xterm/addon-fit';
	import type { Vivari, VivariProcess } from '@vivari/core';

	const { container, cwd }: { container: Vivari; cwd?: string } = $props();

	const options: ITerminalOptions & ITerminalInitOnlyOptions = {
		convertEol: true
	};

	let terminal = $state<Terminal>();
	let terminalHost: HTMLDivElement;
	let input: WritableStreamDefaultWriter<string> | undefined;
	let fitAddon: FitAddon | undefined;
	let shellProcess: VivariProcess | undefined;

	onMount(() => {
		const observer = new ResizeObserver(resize);
		observer.observe(terminalHost);
		return () => observer.disconnect();
	});

	onDestroy(() => shellProcess?.kill());

	function resize() {
		fitAddon?.fit();
	}

	async function onLoad() {
		fitAddon = new (await XtermAddon.FitAddon()).FitAddon();
		terminal?.loadAddon(fitAddon);
		fitAddon.fit();

		shellProcess = await container.spawn('sh', [], { cwd });

		shellProcess.output.pipeTo(
			new WritableStream({
				write(data) {
					terminal?.write(data);
				}
			})
		);

		input = shellProcess.input.getWriter();
	}

	function onData(data: string) {
		input?.write(data);
	}
</script>

<div bind:this={terminalHost} class="terminal-host h-full w-full bg-black">
	<Xterm bind:terminal {options} {onLoad} {onData} />
</div>

<style>
	.terminal-host > :global(div) {
		height: 100%;
		width: 100%;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
	}
</style>
