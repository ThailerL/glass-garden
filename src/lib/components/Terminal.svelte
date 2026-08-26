<script lang="ts">
	import { Xterm, XtermAddon } from '@battlefieldduck/xterm-svelte';
	import type {
		ITerminalOptions,
		ITerminalInitOnlyOptions,
		Terminal
	} from '@battlefieldduck/xterm-svelte';
	import type { FitAddon } from '@xterm/addon-fit';
	import type { WebContainer, WebContainerProcess } from '@webcontainer/api';

	const { webContainer, cwd }: { webContainer: WebContainer; cwd?: string } = $props();

	const options: ITerminalOptions & ITerminalInitOnlyOptions = {
		convertEol: true
	};

	let terminal = $state<Terminal>();
	let terminalHost: HTMLDivElement;
	let input: WritableStreamDefaultWriter<string> | undefined;
	let fitAddon: FitAddon | undefined;
	let shellProcess: WebContainerProcess | undefined;

	$effect(() => {
		const observer = new ResizeObserver(resize);
		observer.observe(terminalHost);
		return () => observer.disconnect();
	});

	function resize() {
		fitAddon?.fit();
		if (terminal) shellProcess?.resize({ cols: terminal.cols, rows: terminal.rows });
	}

	async function onLoad() {
		fitAddon = new (await XtermAddon.FitAddon()).FitAddon();
		terminal?.loadAddon(fitAddon);
		fitAddon.fit();

		shellProcess = await webContainer.spawn('jsh', {
			cwd,
			terminal: {
				cols: terminal?.cols ?? 80,
				rows: terminal?.rows ?? 24
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
