import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Node } from '@xyflow/svelte';
import { Orchestrator } from '$lib/orchestrator.svelte';
import { GraphState, nodeConfig } from '$lib/graph-state.svelte';
import type { ResourceType } from '$lib/resources';

// Reservation logic is tested against a real GraphState (persistence and node
// replacement are part of the contract) and real controllers for live-instance state;
// only the container, the resource registry and the toaster are faked
const fake = vi.hoisted(() => ({ stopFails: false }));

vi.mock('$lib/container', () => ({
	getContainer: vi.fn(async () => ({ on: vi.fn() })),
	mountNodeFiles: vi.fn(),
	removeNodeFiles: vi.fn(),
	shutdownContainer: vi.fn(),
	requestPersistentStorage: vi.fn(),
	setActiveProject: vi.fn()
}));
vi.mock('$lib/files/node-files', () => ({ nodeFiles: () => ({}) }));
vi.mock('svelte-sonner', () => ({
	toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() }
}));
vi.mock('$lib/resources', async () => {
	const { z } = await import('zod');
	const definition = {
		name: 'Test resource',
		ownsStoredData: false,
		configSchema: z.object({
			name: z.string().default('Test resource'),
			instanceCount: z.number().default(1),
			command: z.string().default('run')
		}),
		instanceCount: (node: Node) => (node.data as { config: Config }).config.instanceCount,
		launchConfig: (node: Node) => ({ command: (node.data as { config: Config }).config.command }),
		readyOnStart: true,
		start: async () => ({
			// Never exits on its own; a failing stop is how a test makes an instance stick
			exited: new Promise<number>(() => {}),
			stop: async () => {
				if (fake.stopFails) throw new Error('kill failed');
			}
		})
	};
	return {
		resourceDefinitions: { test: definition },
		getResourceDefinition: () => definition
	};
});

type Config = { name: string; instanceCount: number; command: string };

function makeLocalStorage(): Storage {
	const entries = new Map<string, string>();
	return {
		get length() {
			return entries.size;
		},
		key: (index: number) => [...entries.keys()][index] ?? null,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => void entries.set(key, String(value)),
		removeItem: (key: string) => void entries.delete(key),
		clear: () => entries.clear()
	};
}

function setup(counts: number[]) {
	const graphState = new GraphState('p1');
	const nodeIds = counts.map((instanceCount) => {
		const node = graphState.addNode('test' as ResourceType, { x: 0, y: 0 });
		setCount(graphState, node.id, instanceCount);
		return node.id;
	});
	const orchestrator = new Orchestrator(graphState);
	return { graphState, orchestrator, nodeIds };
}

function setCount(graphState: GraphState, id: string, instanceCount: number) {
	const node = graphState.getNode(id)!;
	graphState.updateNodeConfig(id, { ...nodeConfig<Config>(node), instanceCount });
}

const storedPorts = (id: string) =>
	(JSON.parse(localStorage.getItem(`graph:p1:node:${id}`)!) as { data: { ports: number[] } }).data
		.ports;

// Every fake resolves in a microtask, so draining the queue settles a convergence
async function settle() {
	for (let i = 0; i < 30; i++) await Promise.resolve();
}

beforeEach(() => {
	globalThis.localStorage = makeLocalStorage();
	fake.stopFails = false;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Orchestrator port reservations', () => {
	it('reserves every node to its configured count on construction, without collisions', () => {
		const { orchestrator, nodeIds } = setup([2, 1]);
		const [a, b] = nodeIds;

		expect(orchestrator.getReservedPorts(a)).toHaveLength(2);
		expect(orchestrator.getReservedPorts(b)).toHaveLength(1);
		const all = [...orchestrator.getReservedPorts(a), ...orchestrator.getReservedPorts(b)];
		expect(new Set(all).size).toBe(3);
		// Reservations are persisted with the node, not just held in memory
		expect(storedPorts(a)).toEqual([...orchestrator.getReservedPorts(a)]);
	});

	it('resizes only on refresh, keeping reads pure', () => {
		const { graphState, orchestrator, nodeIds } = setup([1]);
		const [id] = nodeIds;
		const [first] = orchestrator.getReservedPorts(id);

		// A config change alone does nothing; the reservation moves at the event site
		setCount(graphState, id, 3);
		expect(orchestrator.getReservedPorts(id)).toEqual([first]);

		orchestrator.refresh(id);
		expect(orchestrator.getReservedPorts(id)).toHaveLength(3);
		expect(orchestrator.getReservedPorts(id)[0]).toBe(first);

		// Repeated reads change nothing, and a missing node reads as empty
		const before = localStorage.getItem(`graph:p1:node:${id}`);
		orchestrator.getReservedPorts(id);
		orchestrator.getReservedPorts(id);
		expect(localStorage.getItem(`graph:p1:node:${id}`)).toBe(before);
		expect(orchestrator.getReservedPorts('missing')).toEqual([]);

		setCount(graphState, id, 1);
		orchestrator.refresh(id);
		expect(orchestrator.getReservedPorts(id)).toEqual([first]);
	});

	it('assigns instances only reserved ports and hands freed ones back', async () => {
		const { orchestrator, nodeIds } = setup([2]);
		const [id] = nodeIds;
		const reserved = [...orchestrator.getReservedPorts(id)];

		orchestrator.start(id);
		await settle();
		const running = orchestrator.getInstances(id).map((instance) => instance.port);
		expect(running.toSorted()).toEqual(reserved.toSorted());

		orchestrator.stop(id);
		await settle();
		expect(orchestrator.getInstances(id)).toHaveLength(0);
		expect(orchestrator.getReservedPorts(id)).toEqual(reserved);

		orchestrator.start(id);
		await settle();
		const respawned = orchestrator.getInstances(id).map((instance) => instance.port);
		expect(respawned.toSorted()).toEqual(reserved.toSorted());
	});

	it('holds a scaled-down port while its instance resists the kill, releasing it after', async () => {
		const { graphState, orchestrator, nodeIds } = setup([2]);
		const [id] = nodeIds;

		orchestrator.start(id);
		await settle();
		const [kept, doomed] = orchestrator.getReservedPorts(id);

		fake.stopFails = true;
		setCount(graphState, id, 1);
		orchestrator.refresh(id);
		await settle();
		// The kill failed, so the surplus instance keeps its slot and its reservation
		expect(orchestrator.getInstanceStatus(id, doomed)).toBe('unresponsive');
		expect(orchestrator.getReservedPorts(id)).toEqual([kept, doomed]);

		fake.stopFails = false;
		orchestrator.refresh(id);
		await settle();
		expect(orchestrator.getInstances(id).map((instance) => instance.port)).toEqual([kept]);
		expect(orchestrator.getReservedPorts(id)).toEqual([kept]);
	});

	it('self-heals a reservation that fell short by minting an overflow port', async () => {
		const { graphState, orchestrator, nodeIds } = setup([1]);
		const [id] = nodeIds;

		orchestrator.start(id);
		await settle();
		const [original] = orchestrator.getReservedPorts(id);

		// A count change that skipped its refresh leaves the reservation one short; the
		// spawn finds every reserved port taken and mints the missing one on the spot
		setCount(graphState, id, 2);
		orchestrator.start(id);
		await settle();
		expect(orchestrator.getReservedPorts(id)).toHaveLength(2);
		const overflow = orchestrator.getReservedPorts(id)[1];
		expect(overflow).not.toBe(original);
		expect(orchestrator.getInstanceStatus(id, original)).toBe('running');
		expect(orchestrator.getInstanceStatus(id, overflow)).toBe('running');
		expect(storedPorts(id)).toEqual([original, overflow]);
	});

	it('never mints the port of a deleted node still winding down', async () => {
		const { graphState, orchestrator, nodeIds } = setup([1, 1]);
		const [a, b] = nodeIds;

		orchestrator.start(a);
		await settle();
		const [draining] = orchestrator.getReservedPorts(a);

		// Delete node A the way the canvas does, with a kill that fails: the node is gone
		// but its unresponsive instance still occupies the port
		fake.stopFails = true;
		const nodeA = graphState.nodes.find((node) => node.id === a)!;
		graphState.deleteNodeFromStorage(a);
		graphState.nodes = graphState.nodes.filter((node) => node.id !== a);
		orchestrator.remove(nodeA);
		await settle();
		expect(orchestrator.getReservedPorts(a)).toEqual([]);
		expect(orchestrator.getInstanceStatus(a, draining)).toBe('unresponsive');

		// Force the next mint to try the draining port first; the sampler must skip it
		const realRandom = Math.random.bind(Math);
		let offered = false;
		vi.spyOn(Math, 'random').mockImplementation(() => {
			if (offered) return realRandom();
			offered = true;
			return (draining - 1024 + 0.5) / (49151 - 1024 + 1);
		});
		setCount(graphState, b, 2);
		orchestrator.refresh(b);
		expect(offered).toBe(true);
		expect(orchestrator.getReservedPorts(b)).not.toContain(draining);
	});
});
