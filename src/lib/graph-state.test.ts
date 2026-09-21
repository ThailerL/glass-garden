import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	GraphState,
	nameTakenByChallenge,
	nodeChart,
	nodeTestEvent
} from '$lib/graph-state.svelte';
import type { ResourceType } from '$lib/resources';

vi.mock('$lib/container', () => ({
	requestPersistentStorage: vi.fn(),
	setActiveProject: vi.fn()
}));
vi.mock('$lib/resources', async () => {
	const { z } = await import('zod');
	const definition = {
		ownsStoredData: false,
		configSchema: z.object({ name: z.string().default('Test resource') })
	};
	return { resourceDefinitions: { test: definition }, getResourceDefinition: () => definition };
});

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

beforeEach(() => {
	globalThis.localStorage = makeLocalStorage();
});

const stored = (id: string) =>
	(JSON.parse(localStorage.getItem(`graph:p1:node:${id}`)!) as { data: { chart?: string } }).data
		.chart;

describe('node chart', () => {
	it('is pinned on creation only when a template asks', () => {
		const graph = new GraphState('p1');
		const plain = graph.addNode('test' as ResourceType, { x: 0, y: 0 });
		const pinned = graph.addNode('test' as ResourceType, { x: 0, y: 0 }, { chart: 'requests' });
		expect(nodeChart(plain)).toBeUndefined();
		expect(nodeChart(pinned)).toBe('requests');
		expect(stored(pinned.id)).toBe('requests');
	});

	it('can be pinned, replaced and unpinned, and each survives a reload', () => {
		const graph = new GraphState('p1');
		const { id } = graph.addNode('test' as ResourceType, { x: 0, y: 0 });
		graph.setNodeChart(id, 'requests');
		graph.setNodeChart(id, 'latency');
		expect(nodeChart(graph.getNode(id)!)).toBe('latency');
		expect(nodeChart(new GraphState('p1').getNode(id)!)).toBe('latency');
		graph.setNodeChart(id, undefined);
		expect(nodeChart(graph.getNode(id)!)).toBeUndefined();
		expect(stored(id)).toBeUndefined();
	});
});

describe('deletable', () => {
	it('is asked for rather than read off the node, and survives a reload', () => {
		const graph = new GraphState('p1');
		const mine = graph.addNode('test' as ResourceType, { x: 0, y: 0 });
		const scenery = graph.addNode('test' as ResourceType, { x: 0, y: 0 }, { authored: true });
		const needed = graph.addNode(
			'test' as ResourceType,
			{ x: 0, y: 0 },
			{ authored: true, deletable: false }
		);
		expect(mine.deletable).toBe(true);
		expect(scenery.deletable).toBe(true);
		expect(needed.deletable).toBe(false);
		// The flow reads it off the node, so it has to come back with one
		expect(new GraphState('p1').getNode(needed.id)!.deletable).toBe(false);
	});
});

describe('node test event', () => {
	it('is absent until the node is tested, then survives a reload', () => {
		const graph = new GraphState('p1');
		const { id } = graph.addNode('test' as ResourceType, { x: 0, y: 0 });
		expect(nodeTestEvent(graph.getNode(id)!)).toBeUndefined();
		graph.setNodeTestEvent(id, '{"hello":"world"}');
		expect(nodeTestEvent(new GraphState('p1').getNode(id)!)).toBe('{"hello":"world"}');
	});

	it('comes back with an imported node, which is how an export carries one', () => {
		const graph = new GraphState('p1');
		const node = graph.addNode('test' as ResourceType, { x: 0, y: 0 }, { testEvent: '{}' });
		expect(nodeTestEvent(node)).toBe('{}');
	});
});

describe('nameTakenByChallenge', () => {
	const canvas = () => {
		const graph = new GraphState('p1');
		const add = (name: string, authored?: boolean) =>
			graph.addNode('test' as ResourceType, { x: 0, y: 0 }, { config: { name }, authored });
		const app = add('App', true);
		const spare = add('Spare', true);
		const mine = add('Mine');
		return { nodes: graph.nodes, app, spare, mine };
	};

	it('refuses a name another of the challenge\u2019s nodes answers to', () => {
		const { nodes, spare } = canvas();
		expect(nameTakenByChallenge(nodes, spare, 'App')).toBe(true);
	});

	it('leaves a node its own name, and every name no challenge node holds', () => {
		const { nodes, app, spare } = canvas();
		expect(nameTakenByChallenge(nodes, app, 'App')).toBe(false);
		expect(nameTakenByChallenge(nodes, spare, 'Mine')).toBe(false);
	});

	it('holds nothing against the reader, whose nodes no goal can name', () => {
		const { nodes, mine } = canvas();
		expect(nameTakenByChallenge(nodes, mine, 'App')).toBe(false);
	});
});
