import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Node } from '@xyflow/svelte';
import type { Vivari } from '@vivari/core';
import type { InstanceHandle, ResourceDefinition } from '$lib/resources/types';
import { ResourceController, type ControllerServices } from '$lib/resource-controller.svelte';
import { METRIC_SENTINEL } from '$lib/metrics';

// The controller is tested through its ControllerServices seam; everything it reaches
// past that seam is faked out so no container, graph or DOM is needed
vi.mock('$lib/container', () => ({ mountNodeFiles: vi.fn() }));
vi.mock('$lib/node-files', () => ({ nodeFiles: () => ({}) }));
vi.mock('$lib/graph-state.svelte', () => ({
	nodeName: (node: Node) => (node.data as { config: { name: string } }).config.name
}));
vi.mock('svelte-sonner', () => ({
	toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() }
}));

type Config = { name: string; instanceCount: number; command: string };

function makeNode(config: Partial<Config> = {}): Node {
	return {
		id: 'node-1',
		type: 'test',
		position: { x: 0, y: 0 },
		data: {
			config: { name: 'Test resource', instanceCount: 1, command: 'run', ...config },
			ports: []
		}
	};
}

const configOf = (node: Node) => (node.data as { config: Config }).config;

// A handle whose exit the test controls; resolving `exit` is the process dying
function makeHandle() {
	let exit!: (code: number) => void;
	const handle: InstanceHandle = {
		exited: new Promise<number>((resolve) => (exit = resolve)),
		stop: vi.fn(async () => {})
	};
	return { handle, exit };
}

function makeDefinition(overrides: Partial<ResourceDefinition> = {}) {
	const handles: ReturnType<typeof makeHandle>[] = [];
	const definition = {
		name: 'Test resource',
		instanceCount: (node: Node) => configOf(node).instanceCount,
		launchConfig: (node: Node) => ({ command: configOf(node).command }),
		readyOnStart: true,
		start: vi.fn(async () => {
			const made = makeHandle();
			handles.push(made);
			return made.handle;
		}),
		...overrides
	} as unknown as ResourceDefinition;
	return { definition, handles };
}

function makeServices(getNode: () => Node | undefined): ControllerServices {
	return {
		getNode,
		getContainer: async () => ({}) as Vivari,
		takePort: vi.fn(),
		reconcileReservations: vi.fn(),
		getUpstreams: () => [],
		scheduleDependents: vi.fn(),
		unregister: vi.fn()
	};
}

function setup(config: Partial<Config> = {}, overrides: Partial<ResourceDefinition> = {}) {
	const node = makeNode(config);
	const { definition, handles } = makeDefinition(overrides);
	const services = makeServices(() => node);
	const controller = new ResourceController(node.id, definition, services);
	// Mirrors the orchestrator's #takePort: the lowest port no live instance holds, so a
	// released port is handed back to the next spawn
	services.takePort = vi.fn(() => {
		const used = new Set(controller.instances.map((instance) => instance.port));
		for (let port = 3001; ; port++) if (!used.has(port)) return port;
	});
	return { node, definition, handles, services, controller };
}

// Every fake resolves in a microtask, so draining the queue settles a convergence
async function settle() {
	for (let i = 0; i < 30; i++) await Promise.resolve();
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('ResourceController', () => {
	it('brings up the configured count on distinct taken ports', async () => {
		const { services, controller } = setup({ instanceCount: 3 });

		controller.start();
		await settle();

		expect(controller.instances.map((instance) => instance.status)).toEqual([
			'running',
			'running',
			'running'
		]);
		expect(new Set(controller.instances.map((instance) => instance.port)).size).toBe(3);
		expect(controller.status).toBe('running');
		expect(services.reconcileReservations).toHaveBeenCalled();
		// Three running endpoints is a change from none, so dependents hear about it
		expect(services.scheduleDependents).toHaveBeenCalled();
	});

	it('holds a server-hosting instance at starting until server-ready promotes it', async () => {
		const { services, controller } = setup({}, { readyOnStart: false });

		controller.start();
		await settle();
		expect(controller.status).toBe('starting');
		expect(services.scheduleDependents).not.toHaveBeenCalled();

		const port = controller.instances[0].port;
		expect(controller.onServerReady(port, `http://x/${port}/`)).toBe(true);
		await settle();
		expect(controller.instances[0].status).toBe('running');
		expect(controller.instances[0].previewUrl).toBe(`http://x/${port}/`);
		expect(services.scheduleDependents).toHaveBeenCalled();
		// A port no instance holds is not this controller's to claim
		expect(controller.onServerReady(59999, 'http://x/59999/')).toBe(false);
	});

	it('bounces instances on a launch config change but not on a rename', async () => {
		const { node, definition, handles, controller } = setup();

		controller.start();
		await settle();
		const originalPort = controller.instances[0].port;

		configOf(node).name = 'Renamed';
		controller.schedule();
		await settle();
		expect(definition.start).toHaveBeenCalledTimes(1);

		configOf(node).command = 'run --fixed';
		controller.schedule();
		await settle();
		expect(handles[0].handle.stop).toHaveBeenCalled();
		expect(definition.start).toHaveBeenCalledTimes(2);
		// The bounced instance freed its reserved port, so the replacement takes it back
		expect(controller.instances[0].port).toBe(originalPort);
		expect(controller.events.some((event) => event.text.includes('Config changed'))).toBe(true);
	});

	it('scales down from the tail and back up with new instances', async () => {
		const { node, controller } = setup({ instanceCount: 3 });

		controller.start();
		await settle();
		const [first] = controller.instances.map((instance) => instance.port);

		configOf(node).instanceCount = 1;
		controller.schedule();
		await settle();
		expect(controller.instances.map((instance) => instance.port)).toEqual([first]);

		configOf(node).instanceCount = 2;
		controller.schedule();
		await settle();
		expect(controller.instances).toHaveLength(2);
		expect(controller.instances[0].port).toBe(first);
	});

	it('nets a stop during a start pass to everything stopped', async () => {
		let release!: () => void;
		const pending: ReturnType<typeof makeHandle>[] = [];
		const { controller } = setup(
			{},
			{
				start: vi.fn(
					() =>
						new Promise<InstanceHandle>((resolve) => {
							const made = makeHandle();
							pending.push(made);
							release = () => resolve(made.handle);
						})
				)
			}
		);

		controller.start();
		await settle();
		// The spawn is still in flight when desired flips to stopped
		controller.stop();
		release();
		await settle();

		expect(pending[0].handle.stop).toHaveBeenCalled();
		expect(controller.instances).toHaveLength(0);
		expect(controller.status).toBe('stopped');
	});

	it('respawns a crashed instance after the delay and counts the restart', async () => {
		const { definition, handles, controller } = setup();

		controller.start();
		await settle();
		const port = controller.instances[0].port;

		handles[0].exit(1);
		await settle();
		expect(controller.instances[0].status).toBe('crashed');

		await vi.advanceTimersByTimeAsync(2100);
		await settle();
		expect(controller.instances[0].status).toBe('running');
		expect(controller.instances[0].port).toBe(port);
		expect(controller.restarts).toBe(1);
		expect(definition.start).toHaveBeenCalledTimes(2);
	});

	it('counts siblings that die together as one restart, not one each', async () => {
		const { definition, handles, controller } = setup({ instanceCount: 3 });

		controller.start();
		await settle();

		for (const { exit } of handles) exit(1);
		await settle();

		await vi.advanceTimersByTimeAsync(2100);
		await settle();

		// One pass freed all three and respawned them as a single deployment, so the count
		// tracks the incident rather than the process churn it took to recover from it
		expect(controller.restarts).toBe(1);
		expect(definition.start).toHaveBeenCalledTimes(6);
		expect(controller.status).toBe('running');
	});

	it('marks an auto-respawned instance as a replacement, but not a first start', async () => {
		const { handles, controller } = setup();

		controller.start();
		await settle();
		expect(controller.instances[0].replacement).toBe(false);

		handles[0].exit(1);
		await settle();
		await vi.advanceTimersByTimeAsync(2100);
		await settle();

		expect(controller.instances[0].replacement).toBe(true);
	});

	it('does not charge a restart when an explicit start clears a crashed pool', async () => {
		const { handles, controller } = setup();

		controller.start();
		await settle();

		// Crashed and sitting out the restart delay, which is where the pool is visibly
		// crashed and start is still offered
		handles[0].exit(1);
		await settle();
		expect(controller.instances[0].status).toBe('crashed');

		// Pressing start is not an auto-restart, and what it puts up is not a replacement
		controller.start();
		await settle();

		expect(controller.restarts).toBe(0);
		expect(controller.instances[0].status).toBe('running');
		expect(controller.instances[0].replacement).toBe(false);
	});

	it('pauses restarts after three failed deployments, charging each deployment once', async () => {
		const { node, definition, handles, controller } = setup(
			{ instanceCount: 2 },
			{ readyOnStart: false }
		);

		controller.start();
		await settle();

		// Both instances of a deployment dying before coming up spends one strike, so a
		// third respawn still happens and the fourth does not
		for (let round = 0; round < 3; round++) {
			expect(definition.start).toHaveBeenCalledTimes((round + 1) * 2);
			for (const { exit } of handles.slice(-2)) exit(1);
			await settle();
			await vi.advanceTimersByTimeAsync(2100);
			await settle();
		}
		expect(definition.start).toHaveBeenCalledTimes(6);
		expect(controller.status).toBe('crashed');
		expect(
			controller.events.some((event) => event.text.toLowerCase().includes('restarts paused'))
		).toBe(true);

		// Fixing the config recovers without an explicit start: the stale stamp drops the
		// capped instances and the deficit respawns on the new config
		configOf(node).command = 'run --fixed';
		controller.schedule();
		await settle();
		expect(controller.status).toBe('starting');
		controller.onServerReady(controller.instances[0].port, 'http://x/');
		controller.onServerReady(controller.instances[1].port, 'http://x/');
		expect(controller.status).toBe('running');
	});

	it('keeps an instance that would not die, then lets a retried stop release it', async () => {
		const { handles, controller } = setup();

		controller.start();
		await settle();
		const port = controller.instances[0].port;
		const stop = handles[0].handle.stop as ReturnType<typeof vi.fn>;
		stop.mockRejectedValueOnce(new Error('kill failed'));

		controller.stop();
		await settle();
		// The slot and its port stay held so nothing else is spawned over the process
		expect(controller.instances).toHaveLength(1);
		expect(controller.instances[0].status).toBe('unresponsive');
		expect(controller.instances[0].port).toBe(port);

		controller.stop();
		await settle();
		expect(controller.instances).toHaveLength(0);
	});

	it('unregisters after forget once the last instance is gone', async () => {
		const { services, controller } = setup({ instanceCount: 2 });

		controller.start();
		await settle();
		expect(controller.instances).toHaveLength(2);

		controller.forget();
		await settle();
		expect(controller.instances).toHaveLength(0);
		expect(services.unregister).toHaveBeenCalledTimes(1);
	});
});

describe('metric lines', () => {
	// An instance that prints whatever the test hands it, so the split between output and
	// metrics can be driven a chunk at a time
	async function setupPrinting() {
		let print!: (chunk: string) => void;
		const { controller } = setup({}, {
			start: vi.fn(async () => ({
				exited: new Promise<number>(() => {}),
				stop: vi.fn(async () => {}),
				output: new ReadableStream<string>({
					start: (stream) => {
						print = (chunk) => stream.enqueue(chunk);
					}
				})
			}))
		} as unknown as Partial<ResourceDefinition>);
		controller.start();
		await settle();
		return { controller, print: async (chunk: string) => (print(chunk), settle()) };
	}

	const metric = (body: unknown) => `${METRIC_SENTINEL}${JSON.stringify(body)}\n`;

	it('stores a metric line rather than logging it', async () => {
		const { controller, print } = await setupPrinting();

		await print(metric({ name: 'requests', value: 4 }));

		expect(controller.metrics[3001]?.requests?.buckets).toEqual([{ n: 1, sum: 4, min: 4, max: 4 }]);
		expect(controller.output).toHaveLength(0);
	});

	it('leaves anything else as output', async () => {
		const { controller, print } = await setupPrinting();

		await print('listening on 3001\n');

		expect(controller.output.map((line) => line.text)).toEqual(['listening on 3001']);
		expect(controller.metrics).toEqual({});
	});

	// A line meant as a metric that we cannot read is worth seeing rather than swallowing
	it('logs a malformed metric line and warns once', async () => {
		const { controller, print } = await setupPrinting();

		await print(`${METRIC_SENTINEL}{oh dear\n`);

		expect(controller.output).toHaveLength(1);
		expect(controller.metrics).toEqual({});
		const warnings = controller.events.filter((event) => event.level === 'warning');
		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('not valid JSON');
	});

	it('reassembles a metric line split across chunks', async () => {
		const { controller, print } = await setupPrinting();
		const line = metric({ name: 'requests', value: 4 });

		await print(line.slice(0, 6));
		expect(controller.metrics).toEqual({});

		await print(line.slice(6));
		expect(controller.metrics[3001]?.requests?.buckets[0].sum).toBe(4);
	});

	it('folds repeats of one name into one series', async () => {
		const { controller, print } = await setupPrinting();

		await print(metric({ name: 'requests', value: 1 }));
		await print(metric({ name: 'requests', value: 5 }));
		await print(metric({ name: 'latency', value: 12 }));

		expect(controller.metrics[3001]?.requests?.buckets[0]).toEqual({
			n: 2,
			sum: 6,
			min: 1,
			max: 5
		});
		expect(controller.metrics[3001]?.latency?.buckets[0].n).toBe(1);
	});
});
