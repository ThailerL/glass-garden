import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	parseTrafficLine,
	REORDER_MS,
	TICK_MS,
	Traffic,
	TRAVEL_MS,
	type TrafficServices
} from '$lib/traffic.svelte';

describe('parseTrafficLine', () => {
	it('reads a hop and a level', () => {
		expect(parseTrafficLine('gg:event {"kind":"hop","at":5,"to":{"port":3001}}')).toEqual({
			ok: true,
			event: { kind: 'hop', at: 5, to: { port: 3001 } }
		});
		expect(parseTrafficLine('gg:event {"kind":"level","at":5,"value":2,"capacity":5}')).toEqual({
			ok: true,
			event: { kind: 'level', at: 5, value: 2, capacity: 5 }
		});
	});

	it('names what is wrong with a line it refuses', () => {
		expect(parseTrafficLine('gg:event {nope')).toEqual({ ok: false, reason: 'not JSON' });
		expect(parseTrafficLine('gg:event {"kind":"hop"}')).toEqual({
			ok: false,
			reason: 'a hop without a time'
		});
		expect(parseTrafficLine('gg:event {"kind":"level","at":5}')).toEqual({
			ok: false,
			reason: 'a level without a value'
		});
		expect(parseTrafficLine('gg:event {"kind":"level","value":1}')).toEqual({
			ok: false,
			reason: 'a level without a time'
		});
		expect(parseTrafficLine('gg:event {"kind":"routing","at":5}')).toEqual({
			ok: false,
			reason: 'a routing without its ports'
		});
		expect(parseTrafficLine('gg:event {"kind":"log"}')).toEqual({
			ok: false,
			reason: 'of an unknown kind "log"'
		});
	});
});

// generator → balancer → web (ports 3001-3003) → queue, and queue → fn
const edges: Record<string, string> = {
	'gen>lb': 'e1',
	'lb>web': 'e2',
	'web>queue': 'e3',
	'queue>fn': 'e4'
};
const services: TrafficServices = {
	instanceAt: (port) =>
		port >= 3001 && port <= 3003 ? { nodeId: 'web', lane: port - 3001 } : undefined,
	edgeBetween: (source, target) => edges[`${source}>${target}`]
};

describe('Traffic', () => {
	let traffic: Traffic;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);
		traffic = new Traffic(services);
	});
	afterEach(() => vi.useRealTimers());

	const settle = () => vi.advanceTimersByTime(REORDER_MS);
	const arrival = 1000 + REORDER_MS;
	const hop = (at: number, from: string, to: string) =>
		traffic.ingest(undefined, { kind: 'hop', at, from: { node: from }, to: { node: to } });

	it('turns a hop into a flight on the edge, landing on the named instance', () => {
		traffic.ingest('lb', { kind: 'hop', at: 1, to: { port: 3002 }, count: 10 });
		expect(traffic.flights).toEqual([]);
		settle();
		expect(traffic.flights).toMatchObject([
			{ edgeId: 'e2', reverse: false, lane: 1, count: 10, startedAt: arrival }
		]);
		vi.advanceTimersByTime(TRAVEL_MS + TICK_MS);
		expect(traffic.flights).toEqual([]);
	});

	it('runs backwards along an edge drawn the other way', () => {
		hop(2, 'fn', 'queue');
		settle();
		expect(traffic.flights).toMatchObject([{ edgeId: 'e4', reverse: true, lane: undefined }]);
	});

	it('drops a hop with no edge to ride, and one it cannot resolve', () => {
		traffic.ingest('gen', { kind: 'hop', at: 1, to: { node: 'queue' } });
		traffic.ingest('gen', { kind: 'hop', at: 1, to: { port: 9999 } });
		settle();
		expect(traffic.flights).toEqual([]);
	});

	it('does not let a departure leave before what reached the node has landed', () => {
		traffic.ingest('lb', { kind: 'hop', at: 1, to: { port: 3001 } });
		// Two sends a few ms later, as an instance answering one request with two
		hop(3, 'web', 'queue');
		hop(4, 'web', 'queue');
		settle();
		expect(traffic.flights).toMatchObject([{ edgeId: 'e2', startedAt: arrival }]);
		vi.advanceTimersByTime(TRAVEL_MS + TICK_MS);
		expect(traffic.flights).toMatchObject([
			{ edgeId: 'e3', startedAt: arrival + TRAVEL_MS },
			{ edgeId: 'e3', startedAt: arrival + TRAVEL_MS }
		]);
	});

	it('orders held hops by the VM clock, whichever arrived first', () => {
		hop(3, 'web', 'queue');
		traffic.ingest('lb', { kind: 'hop', at: 1, to: { port: 3001 } });
		settle();
		expect(traffic.flights).toMatchObject([{ edgeId: 'e2', startedAt: arrival }]);
		vi.advanceTimersByTime(TRAVEL_MS + TICK_MS);
		expect(traffic.flights).toMatchObject([{ edgeId: 'e3', startedAt: arrival + TRAVEL_MS }]);
	});

	it('draws a level reported after an arrival once the arrival has landed', () => {
		hop(1, 'queue', 'fn');
		traffic.ingest('fn', { kind: 'level', at: 2, value: 1, capacity: 5 });
		settle();
		expect(traffic.levels).toEqual({});
		vi.advanceTimersByTime(TRAVEL_MS + TICK_MS);
		expect(traffic.levels).toEqual({ fn: { value: 1, capacity: 5, peak: 1 } });
	});

	it('takes a node at its word about which instances it sends to', () => {
		// Nothing said yet: every lane carries traffic until a sender says otherwise
		expect(traffic.routesTo('lb', 3002)).toBe(true);
		traffic.ingest('lb', { kind: 'routing', at: 1, ports: [3001, 3003] });
		expect(traffic.routesTo('lb', 3001)).toBe(true);
		expect(traffic.routesTo('lb', 3002)).toBe(false);
		// One sender's verdict says nothing about another's
		expect(traffic.routesTo('gen', 3002)).toBe(true);
	});

	it('keeps the latest level per node and the peak seen', () => {
		traffic.ingest('fn', { kind: 'level', at: 1, value: 4, capacity: 5 });
		traffic.ingest('fn', { kind: 'level', at: 2, value: 3, capacity: 5 });
		settle();
		expect(traffic.levels).toEqual({ fn: { value: 3, capacity: 5, peak: 4 } });
	});

	it('holds each hop for at least the reorder window from when it arrived', () => {
		traffic.ingest('lb', { kind: 'hop', at: 1, to: { port: 3001 } });
		vi.advanceTimersByTime(REORDER_MS / 2);
		traffic.ingest('lb', { kind: 'hop', at: 2, to: { port: 3001 } });
		vi.advanceTimersByTime(REORDER_MS / 2);
		expect(traffic.flights).toHaveLength(1);
		vi.advanceTimersByTime(TICK_MS);
		expect(traffic.flights).toHaveLength(2);
	});

	it('thins a flood on one edge', () => {
		for (let i = 0; i < 40; i++) traffic.ingest('lb', { kind: 'hop', at: i, to: { port: 3001 } });
		settle();
		expect(traffic.flights).toHaveLength(24);
	});
});
