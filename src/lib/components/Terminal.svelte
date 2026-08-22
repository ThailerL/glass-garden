<script lang="ts">
	import { Xterm, XtermAddon } from '@battlefieldduck/xterm-svelte';
	import type {
		ITerminalOptions,
		ITerminalInitOnlyOptions,
		Terminal
	} from '@battlefieldduck/xterm-svelte';

	const { webContainer } = $props();

	const options: ITerminalOptions & ITerminalInitOnlyOptions = {
		convertEol: true
	};

	let terminal = $state<Terminal>();
	let terminalHost: HTMLDivElement;
	let input;
	let fitAddon;
	let shellProcess;

	$effect(() => {
		const observer = new ResizeObserver(resize);
		observer.observe(terminalHost);
		return () => observer.disconnect();
	});

	function resize() {
		fitAddon.fit();
		shellProcess.resize({ cols: terminal.cols, rows: terminal.rows });
	}

	async function onLoad() {
		fitAddon = new (await XtermAddon.FitAddon()).FitAddon();
		terminal?.loadAddon(fitAddon);
		fitAddon.fit();

		shellProcess = await webContainer.spawn('jsh', {
			terminal: {
				cols: terminal?.cols,
				rows: terminal?.rows
			}
		});

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
		input.write(data);
	}
</script>

<div bind:this={terminalHost} class="terminal-host h-full w-full overflow-hidden">
	<Xterm bind:terminal {options} {onLoad} {onData} />
</div>

<style>
	.terminal-host > :global(div) {
		height: 100%;
		width: 100%;
	}
</style>
