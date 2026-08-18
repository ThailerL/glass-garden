<script lang="ts">
	import { Xterm, XtermAddon } from '@battlefieldduck/xterm-svelte';
	import type {
		ITerminalOptions,
		ITerminalInitOnlyOptions,
		Terminal
	} from '@battlefieldduck/xterm-svelte';

	const options: ITerminalOptions & ITerminalInitOnlyOptions = {
		convertEol: true
	};

	const { webContainer } = $props();

	let terminal = $state<Terminal>();
	let input;
	let fitAddon;
	let shellProcess;

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

<svelte:window
	onresize={() => {
		fitAddon.fit();
		shellProcess.resize({ terminal: { cols: terminal?.cols, rows: terminal?.rows } });
	}}
/>

<Xterm bind:terminal {options} {onLoad} {onData} />
