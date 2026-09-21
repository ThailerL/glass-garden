import { toast } from 'svelte-sonner';
import type { Vivari } from '@vivari/core';
import * as resourceFiles from 'virtual:resource-files';
import { EVENT_PREFIX, emptyTopology } from '../../resources/aws-region/lib.js';
import type { NodeReport, Service, Topology } from '../../resources/aws-region/lib.js';
import type { InstanceHandle } from '$lib/resources/types';
import { activeProjectDirectory, getContainer } from '$lib/container';
import { captureLines } from '$lib/resource-log.svelte';
import { fileTree } from '$lib/files/file-tree';
import { ADMIN_ACCESS_KEY } from '$lib/aws-topology';
import type { Hop, Level } from '$lib/traffic.svelte';
import { withTrailingSlash } from '$lib/utils';

export type { Principal, Service, Topology } from '../../resources/aws-region/lib.js';

// Everything the region prints on its event channel: what it reports about a node, and
// traffic for the canvas in the vocabulary every hidden process shares
export type RegionEvent = NodeReport | Hop | (Level & { nodeId: string });

// Outside the orchestrator's minting range (1024-49151), so it can never collide with
// an instance port
export const REGION_PORT = 52700;
// How code inside the VM reaches the region
export const regionEndpointUrl = `http://localhost:${REGION_PORT}`;

// The emulator mints queue URLs in this shape, and the AWS SDK dials the URL it is handed
// rather than the endpoint, so a consumer's variable has to match it exactly. The account
// is the emulator's own default: our access keys are node ids, not the 12-digit numbers it
// reads an account from
export const queueUrlFor = (queueName: string) => `${regionEndpointUrl}/000000000000/${queueName}`;

const OUTPUT_LIMIT = 500;
const CONTROL_TIMEOUT_MS = 10_000;
const READY_TIMEOUT_MS = 120_000;
const MISSING_JSPI = 'Nothing that uses AWS can run in this browser';
const MISSING_JSPI_CAUSE =
	'The local AWS region needs WebAssembly JSPI, which this browser does not support or has turned off.';
// One id, so every AWS node asking at once shares a toast that stays until closed
const MISSING_JSPI_TOAST = {
	id: 'missing-jspi',
	description: MISSING_JSPI_CAUSE,
	duration: Infinity,
	closeButton: true
};

type Region = {
	ready: Promise<void>;
	directory: string;
	// The page cannot dial VM ports; control calls go through Vivari's preview route
	previewUrl: string;
	token: string;
};

let region: Region | undefined;
let output: string[] = [];
let lastTopology: Topology = emptyTopology();
let consecutiveCrashes = 0;
let onEvent: ((event: RegionEvent) => void) | undefined;

// The region runs no user code and has no node, so its output is held here for
// debugging rather than shown; structured events are handed to the router
export function regionOutput(): readonly string[] {
	return output;
}

// The orchestrator-facing router for gg:event lines (denials into node logs, etc.)
export function onRegionEvent(route: (event: RegionEvent) => void) {
	onEvent = route;
}

function record(line: string) {
	output.push(line);
	if (output.length > OUTPUT_LIMIT) output = output.slice(-OUTPUT_LIMIT);
}

// Only the VM's own output carries events; a malformed one is still in the ring above
function handleOutput(line: string) {
	record(line);
	if (!line.startsWith(EVENT_PREFIX)) return;
	let event: RegionEvent;
	try {
		event = JSON.parse(line.slice(EVENT_PREFIX.length));
	} catch {
		return;
	}
	onEvent?.(event);
}

// Boots on first call and is awaited by every later one, so warming and a resource that
// needs the region share a single boot. The region then lives as long as the container:
// every node can emit CloudWatch, so there is no point at which nothing wants it
export async function ensureRegion(): Promise<void> {
	// pocket-region refuses to boot without JSPI, and finding out that way costs a VM boot
	if (!('Suspending' in WebAssembly)) {
		toast.error(MISSING_JSPI, MISSING_JSPI_TOAST);
		throw new Error(`${MISSING_JSPI}. ${MISSING_JSPI_CAUSE}`);
	}
	region ??= boot();
	await region.ready;
}

// A process-less node's stand-in for a process exit: the region is what it is really
// running on, so an unexpected region death is that node crashing
const exitWaiters = new Set<(code: number) => void>();

export function regionLifetime(): InstanceHandle {
	let waiter!: (code: number) => void;
	// The executor runs before the constructor returns, so waiter is set by the next line
	const exited = new Promise<number>((resolve) => (waiter = resolve));
	exitWaiters.add(waiter);
	return { exited, stop: async () => void exitWaiters.delete(waiter) };
}

// The file is what the region judges requests by; the call that follows is for what it
// serves per node, which cannot wait for the next request to notice
export function setRegionTopology(topology: Topology) {
	lastTopology = topology;
	const current = region;
	if (!current) return;
	void current.ready
		.then(() => writeTopology(current.directory))
		.then(() => control(current, 'control/topology', { method: 'POST' }))
		.catch(() => toast.error('The local AWS region did not pick up the new connections'));
}

// Written whole through a temporary name, so the region can never read half a canvas.
// One write at a time: several refreshes can land in one tick - deleting a node refreshes
// every edge - and interleaved writes would race each other for the temporary file
let topologyWrite: Promise<void> = Promise.resolve();

function writeTopology(directory: string): Promise<void> {
	topologyWrite = topologyWrite
		// The previous write's failure was its caller's to report; this one starts fresh
		.catch(() => {})
		.then(async () => {
			const container = await getContainer();
			const file = `${directory}/topology.json`;
			await container.fs.writeFile(`${file}.tmp`, JSON.stringify(lastTopology));
			await container.fs.rename(`${file}.tmp`, file);
		});
	return topologyWrite;
}

export async function provisionResource(
	service: Service,
	name: string,
	config?: unknown
): Promise<unknown> {
	const current = region;
	if (!current) throw new Error('The region is not running');
	await current.ready;
	const response = await control(current, 'control/provision', {
		method: 'POST',
		body: JSON.stringify({ service, name, config })
	});
	return response.json();
}

export async function deprovisionResource(service: Service, name: string) {
	const current = region;
	if (!current) throw new Error('The region is not running');
	await current.ready;
	await control(current, 'control/deprovision', {
		method: 'POST',
		body: JSON.stringify({ service, name })
	});
}

export type Invocation = { status: number; functionError?: string; payload: string };

// SigV4's shape without a signature, which is all the region enforces on
function adminAuthorization(service: Service) {
	return `AWS4-HMAC-SHA256 Credential=${ADMIN_ACCESS_KEY}/20260101/us-east-1/${service}/aws4_request, SignedHeaders=host, Signature=glass-garden`;
}

// The path an SDK caller takes, so a test reaches the log and metrics like any invocation
export async function invokeFunction(functionName: string, payload: string): Promise<Invocation> {
	await ensureRegion();
	const current = region;
	if (!current) throw new Error('The region is not running');
	const response = await fetch(
		`${withTrailingSlash(current.previewUrl)}2015-03-31/functions/${encodeURIComponent(functionName)}/invocations`,
		{
			method: 'POST',
			headers: {
				authorization: adminAuthorization('lambda'),
				'content-type': 'application/json'
			},
			body: payload
		}
	);
	return {
		status: response.status,
		functionError: response.headers.get('x-amz-function-error') ?? undefined,
		payload: await response.text()
	};
}

// The AWS JSON protocol the SDK speaks. x-gg-observe keeps the read off the node's charts;
// user code is never given the token, so an app cannot hide its own traffic this way
export async function callAws(service: Service, target: string, body: unknown) {
	await ensureRegion();
	const current = region;
	if (!current) throw new Error('The region is not running');
	const response = await fetch(withTrailingSlash(current.previewUrl), {
		method: 'POST',
		headers: {
			authorization: adminAuthorization(service),
			'content-type': 'application/x-amz-json-1.0',
			'x-amz-target': target,
			'x-gg-observe': current.token
		},
		body: JSON.stringify(body),
		// A read that never answers would leave its goal judging for the rest of the run
		signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS)
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`${target} answered ${response.status}: ${text}`);
	return JSON.parse(text) as Record<string, unknown>;
}

function boot(): Region {
	const created: Region = {
		token: crypto.randomUUID(),
		directory: '',
		previewUrl: '',
		ready: Promise.resolve()
	};
	created.ready = (async () => {
		if (consecutiveCrashes > 0) {
			await new Promise((resolve) =>
				setTimeout(resolve, Math.min(2 ** consecutiveCrashes, 30) * 1000)
			);
		}
		const container = await getContainer();
		const directory = `${activeProjectDirectory()}/aws-region`;
		created.directory = directory;
		await ensureCache(container, directory);
		await container.fs.mkdir(directory, { recursive: true });
		await container.mount(resourceFiles.awsRegion, { mountPoint: directory });
		// Before the spawn: the bridge reads this before it listens, so no request is ever
		// judged against a canvas it has not been told about
		await writeTopology(directory);

		// server-ready fires once the port listens and its preview relay is reachable, so
		// control calls made after it cannot race the relay. Subscribed before the spawn;
		// the orchestrator's own listener ignores this port
		let unsubscribe = () => {};
		const ready = new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Region start timed out')), READY_TIMEOUT_MS);
			unsubscribe = container.on('server-ready', (port, url) => {
				if (port !== REGION_PORT) return;
				clearTimeout(timer);
				resolve(url);
			});
		});
		const process = await container.spawn('node', ['server.js'], {
			cwd: directory,
			env: { PORT: String(REGION_PORT), GG_CONTROL_TOKEN: created.token }
		});
		captureLines(process.output, handleOutput);
		void process.exit.then((code) => onExit(created, code));
		try {
			created.previewUrl = await Promise.race([
				ready,
				process.exit.then((code) =>
					Promise.reject(new Error(`Region exited with code ${code} before ready`))
				)
			]);
		} finally {
			unsubscribe();
		}
		consecutiveCrashes = 0;
	})();
	created.ready.catch(() => {
		if (region === created) region = undefined;
		consecutiveCrashes += 1;
		toast.error('The local AWS region could not start');
	});
	return created;
}

// Only an exit we did not ask for is a crash; a graceful stop has already cleared `region`
function onExit(exited: Region, code: number) {
	if (region !== exited) return;
	region = undefined;
	consecutiveCrashes += 1;
	record(`Region process exited with code ${code}`);
	for (const resolve of exitWaiters) resolve(code);
	exitWaiters.clear();
	toast.error('The local AWS region stopped unexpectedly; it restarts on next use');
}

async function control(current: Region, pathname: string, init?: RequestInit) {
	const response = await fetch(withTrailingSlash(current.previewUrl) + pathname, {
		...init,
		headers: { 'x-gg-token': current.token },
		signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS)
	});
	if (!response.ok) throw new Error(`${pathname} answered ${response.status}`);
	return response;
}

// The vendored Python runtime and wheels are copied from this origin into the VFS once;
// the copy survives page reloads and is refreshed when the vendored build changes
async function ensureCache(container: Vivari, directory: string) {
	const response = await fetch('/vendor/aws-region/meta.json');
	if (!response.ok) {
		throw new Error('The vendored Python runtime is missing - run npm run vendor');
	}
	const metaText = await response.text();
	const cacheDir = `${directory}/cache`;
	const existing = await container.fs.readFile(`${cacheDir}/meta.json`, 'utf-8').catch(() => '');
	if (existing === metaText) return;

	record('Copying the Python runtime into the container');
	const { files } = JSON.parse(metaText) as { files: { path: string; bytes: number }[] };
	await container.fs.rm(cacheDir, { recursive: true, force: true });
	const downloads = await Promise.all(
		files.map(async (file) => {
			const asset = await fetch(`/vendor/aws-region/${file.path}`);
			if (!asset.ok) throw new Error(`Could not fetch ${file.path} (status ${asset.status})`);
			const bytes = new Uint8Array(await asset.arrayBuffer());
			if (bytes.length !== file.bytes) {
				throw new Error(`${file.path} downloaded ${bytes.length} bytes, expected ${file.bytes}`);
			}
			return [file.path, bytes] as const;
		})
	);
	await container.mount(fileTree(Object.fromEntries(downloads)), { mountPoint: cacheDir });
	// Written last: an interrupted copy leaves no meta.json, so the next boot recopies
	await container.fs.writeFile(`${cacheDir}/meta.json`, metaText);
}
