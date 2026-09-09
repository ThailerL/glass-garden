<script module lang="ts">
	import type { Node } from '@xyflow/svelte';
	import { awsResourceOf } from '$lib/aws-topology';
	import type { Invocation, Service } from '$lib/aws-region';

	export type EventTemplate = { id: string; label: string; event: unknown };
	export type Outcome = { ok: boolean; detail?: string; body: string };

	const named = (sources: readonly Node[], service: Service) =>
		sources.map(awsResourceOf).find((resource) => resource?.service === service)?.resourceName;

	// The shapes index.mjs promises a handler, as this app really delivers them, addressed to
	// whatever points at this function
	export function eventTemplates(sources: readonly Node[], now = Date.now()): EventTemplate[] {
		const queue = named(sources, 'sqs') ?? 'my-queue';
		const bucket = named(sources, 's3') ?? 'my-bucket';
		return [
			{
				id: 'url',
				label: 'Function URL request',
				event: {
					version: '2.0',
					routeKey: '$default',
					rawPath: '/',
					rawQueryString: '',
					headers: { 'content-type': 'application/json', 'user-agent': 'glass-garden' },
					queryStringParameters: {},
					requestContext: {
						http: {
							method: 'GET',
							path: '/',
							protocol: 'HTTP/1.1',
							sourceIp: '127.0.0.1',
							userAgent: 'glass-garden'
						},
						timeEpoch: now
					},
					isBase64Encoded: false
				}
			},
			{
				id: 'queue',
				label: 'Queue batch',
				event: {
					Records: [
						{
							messageId: '059f36b4-87a3-44ab-83d2-661975830a7d',
							receiptHandle: 'gg-test-receipt',
							body: '{"hello":"world"}',
							attributes: {},
							messageAttributes: {},
							md5OfBody: 'e4e68fb7bd0e697a0ae8f1bb342846b3',
							eventSource: 'aws:sqs',
							eventSourceARN: `arn:aws:sqs:us-east-1:000000000000:${queue}`,
							awsRegion: 'us-east-1'
						}
					]
				}
			},
			{
				id: 'object',
				label: 'Object created',
				event: {
					Records: [
						{
							eventSource: 'aws:s3',
							eventName: 'ObjectCreated:Put',
							s3: { bucket: { name: bucket }, object: { key: 'photo.jpg', size: 1024 } }
						}
					]
				}
			}
		];
	}

	const templateText = (template: EventTemplate) => JSON.stringify(template.event, null, 2);

	function parseJson(text: string) {
		try {
			return JSON.parse(text) as { errorType?: string; errorMessage?: string; message?: string };
		} catch {
			return undefined;
		}
	}

	// A handler that threw answers 200 and says so in a header, as Lambda does
	export function describeOutcome({ status, functionError, payload }: Invocation): Outcome {
		const value = parseJson(payload);
		const body = value === undefined ? payload : JSON.stringify(value, null, 2);
		if (!functionError && status === 200) return { ok: true, body };
		const detail = functionError
			? [value?.errorType, value?.errorMessage].filter(Boolean).join(': ') || undefined
			: value?.message;
		return { ok: false, detail, body };
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import CodeMirror from 'svelte-codemirror-editor';
	import { json } from '@codemirror/lang-json';
	import { dracula } from '@uiw/codemirror-theme-dracula';
	import type { EditorView } from '@codemirror/view';
	import { mode } from 'mode-watcher';
	import PlayIcon from '@lucide/svelte/icons/play';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Spinner } from '$lib/components/ui/spinner';
	import { getGraphState, nodeConfig, nodeTestEvent } from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { invokeFunction } from '$lib/aws-region';
	import { messageOf } from '$lib/errors';
	import type { Config } from './index';

	const { nodeId }: { nodeId: string } = $props();

	const graphState = getGraphState();
	const orchestrator = getOrchestrator();

	const node = $derived(graphState.getNode(nodeId));
	const templates = $derived(
		eventTemplates(orchestrator.getSources(nodeId).map(({ node }) => node))
	);

	let event = $state(untrack(() => (node && nodeTestEvent(node)) ?? templateText(templates[0])));
	let running = $state(false);
	let outcome = $state<Outcome>();

	const status = $derived(orchestrator.getStatus(nodeId));
	// Every other status means the port will hang up rather than answer
	const canInvoke = $derived(status === 'running' || status === 'degraded');

	let view: EditorView | undefined;

	// Dispatched rather than assigned: assigning rebuilds the editor's state, which drops the
	// history that makes the load undoable
	function load(template: EventTemplate) {
		const text = templateText(template);
		if (!view) return void (event = text);
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
	}

	async function invoke() {
		if (!node) return;
		running = true;
		outcome = undefined;
		graphState.setNodeTestEvent(nodeId, event);
		try {
			outcome = describeOutcome(await invokeFunction(nodeConfig<Config>(node).functionName, event));
		} catch (error) {
			outcome = { ok: false, detail: messageOf(error), body: '' };
		} finally {
			running = false;
		}
	}
</script>

<div class="flex h-full flex-col gap-2 p-2">
	<div class="flex items-center gap-2">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm">Load template</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start">
				{#each templates as template (template.id)}
					<DropdownMenu.Item onSelect={() => load(template)}>
						{template.label}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		<span class="ml-auto text-xs text-muted-foreground">
			{#if !canInvoke}Start the function to test it{/if}
		</span>
		<Button size="sm" disabled={!canInvoke || running} onclick={invoke}>
			{#if running}
				<Spinner class="size-3" />
			{:else}
				<PlayIcon />
			{/if}
			Invoke
		</Button>
	</div>

	<div class="min-h-24 flex-1 overflow-hidden rounded-md border">
		<CodeMirror
			class="h-full"
			bind:value={event}
			onready={(ready) => (view = ready)}
			nodebounce={true}
			lang={json()}
			lineWrapping={true}
			theme={mode.current === 'dark' ? dracula : undefined}
			styles={{ '&': { height: '100%', width: '100%' } }}
		/>
	</div>

	{#if outcome}
		<div class="max-h-48 shrink-0 overflow-y-auto rounded-md border p-2">
			<div class="flex flex-wrap items-baseline gap-x-2 text-sm">
				<span class={outcome.ok ? 'text-green-600 dark:text-green-500' : 'text-destructive'}>
					{outcome.ok ? 'Succeeded' : 'Failed'}
				</span>
				{#if outcome.detail}
					<span class="wrap-anywhere text-muted-foreground">{outcome.detail}</span>
				{/if}
			</div>
			{#if outcome.body}
				<pre class="mt-1 font-mono text-xs whitespace-pre-wrap">{outcome.body}</pre>
			{/if}
		</div>
	{/if}
</div>
