import { EVENT_PREFIX } from '../../resources/aws-region/lib.js';

// Traffic for the canvas, printed as `gg:event {json}` by hidden code and the region. A hop
// is one request crossing an edge, a level is what a node is holding. A node process leaves
// out the side that is itself; the region names both
export type Endpoint = { node: string } | { port: number };
export type Hop = { kind: 'hop'; at: number; from?: Endpoint; to?: Endpoint; count?: number };
export type Level = { kind: 'level'; at: number; value: number; capacity?: number };
// Which of a target's instances a node is sending to. Not "healthy": a balancer with nothing
// healthy left routes to every target regardless, and those lanes are carrying dots
export type Routing = { kind: 'routing'; at: number; ports: number[] };
export type TrafficEvent = Hop | Level | Routing;

export type ParsedTraffic = { ok: true; event: TrafficEvent } | { ok: false; reason: string };

export function looksLikeTraffic(line: string) {
	return line.startsWith(EVENT_PREFIX);
}

export function parseTrafficLine(line: string): ParsedTraffic {
	let event: Record<string, unknown>;
	try {
		event = JSON.parse(line.slice(EVENT_PREFIX.length));
	} catch {
		return { ok: false, reason: 'not JSON' };
	}
	const kinds = ['hop', 'level', 'routing'];
	if (typeof event.kind !== 'string' || !kinds.includes(event.kind)) {
		return { ok: false, reason: `of an unknown kind "${String(event.kind)}"` };
	}
	if (typeof event.at !== 'number') return { ok: false, reason: `a ${event.kind} without a time` };
	if (event.kind === 'level' && typeof event.value !== 'number') {
		return { ok: false, reason: 'a level without a value' };
	}
	if (event.kind === 'routing' && !Array.isArray(event.ports)) {
		return { ok: false, reason: 'a routing without its ports' };
	}
	return { ok: true, event: event as unknown as TrafficEvent };
}

export const TRAVEL_MS = 600;
// Events wait this long and go in the VM's order: their stdouts reach the page in no fixed order
export const REORDER_MS = 100;
export const TICK_MS = 100;
const MAX_FLIGHTS_PER_EDGE = 24;

export type Flight = {
	id: number;
	edgeId: string;
	// Along the edge from its target to its source
	reverse: boolean;
	// Which of the target's instances the dot lands on, when the hop named a port
	lane: number | undefined;
	startedAt: number;
	count: number;
};

// peak is the most seen this session, a gauge's full mark when there is no capacity
export type NodeLevel = { value: number; capacity?: number; peak: number };

export type TrafficServices = {
	instanceAt: (port: number) => { nodeId: string; lane: number } | undefined;
	edgeBetween: (source: string, target: string) => string | undefined;
};

type Held = { at: number; receivedAt: number } & (
	| { kind: 'hop'; count: number; from: string; to: string; lane: number | undefined }
	| { kind: 'level'; nodeId: string; value: number; capacity?: number }
);
type PendingLevel = { nodeId: string; value: number; capacity?: number; applyAt: number };

// Every dot in flight and every level reported. Nothing persists. Nothing at a node is drawn
// before what reached it has landed: a departure or a level waits for the newest arrival
export class Traffic {
	flights = $state.raw<Flight[]>([]);
	levels = $state.raw<Record<string, NodeLevel>>({});
	// By the node doing the sending, since two balancers on one group can disagree
	routing = $state.raw<Record<string, number[]>>({});

	#services: TrafficServices;
	#held: Held[] = [];
	#waiting: Flight[] = [];
	#pendingLevels: PendingLevel[] = [];
	#timer: ReturnType<typeof setTimeout> | undefined;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#landsAt = new Map<string, number>();
	#nextId = 1;

	constructor(services: TrafficServices) {
		this.#services = services;
	}

	// A node sends to every instance it names, and to no other. Unknown until it says
	routesTo(nodeId: string, port: number) {
		const ports = this.routing[nodeId];
		return ports === undefined || ports.includes(port);
	}

	// nodeId is the process that printed the event, and the side a hop leaves unnamed
	ingest(nodeId: string | undefined, event: TrafficEvent) {
		const { at } = event;
		const receivedAt = Date.now();
		// Not caused by an arrival, so it is not held back for one
		if (event.kind === 'routing') {
			if (nodeId) this.routing = { ...this.routing, [nodeId]: event.ports };
			return;
		}
		if (event.kind === 'level') {
			if (!nodeId) return;
			const { value, capacity } = event;
			this.#held.push({ kind: 'level', at, receivedAt, nodeId, value, capacity });
		} else {
			const from = event.from ? this.#resolve(event.from)?.nodeId : nodeId;
			const to = event.to ? this.#resolve(event.to) : nodeId ? { nodeId } : undefined;
			if (!from || !to || from === to.nodeId) return;
			const count = event.count ?? 1;
			this.#held.push({ kind: 'hop', at, receivedAt, count, from, to: to.nodeId, lane: to.lane });
		}
		this.#arm();
	}

	// Nothing reports a level for a node that is down, so its last one would stand
	forget(nodeId: string) {
		this.#held = this.#held.filter((held) => held.kind !== 'level' || held.nodeId !== nodeId);
		this.#pendingLevels = this.#pendingLevels.filter((level) => level.nodeId !== nodeId);
		const { [nodeId]: gone, ...levels } = this.levels;
		if (gone) this.levels = levels;
	}

	#resolve(endpoint: Endpoint): { nodeId: string; lane?: number } | undefined {
		if ('node' in endpoint) return { nodeId: endpoint.node };
		return this.#services.instanceAt(endpoint.port);
	}

	#arm() {
		if (!this.#timer) this.#timer = setTimeout(() => this.#tick(), TICK_MS);
	}

	// One clock: releases what has waited out the reorder window, starts flights and applies
	// levels whose time has come, drops flights that have landed, and writes state once
	#tick() {
		this.#timer = undefined;
		const now = Date.now();
		const end = this.#held.findIndex((held) => held.receivedAt + REORDER_MS > now);
		const due = this.#held.splice(0, end === -1 ? this.#held.length : end);
		for (const held of due.sort((a, b) => a.at - b.at)) {
			if (held.kind === 'hop') this.#launch(held, now);
			else this.#settle(held, now);
		}

		const starting = this.#waiting.filter((flight) => flight.startedAt <= now);
		this.#waiting = this.#waiting.filter((flight) => flight.startedAt > now);
		const flying = this.flights.filter((flight) => flight.startedAt + TRAVEL_MS > now);
		if (starting.length > 0 || flying.length !== this.flights.length) {
			this.flights = [...flying, ...starting];
		}

		const applying = this.#pendingLevels.filter((level) => level.applyAt <= now);
		this.#pendingLevels = this.#pendingLevels.filter((level) => level.applyAt > now);
		if (applying.length > 0) {
			const levels = { ...this.levels };
			for (const { nodeId, value, capacity } of applying) {
				const peak = Math.max(levels[nodeId]?.peak ?? 0, value);
				levels[nodeId] = { value, capacity, peak };
			}
			this.levels = levels;
		}

		if (
			this.#held.length +
			this.#waiting.length +
			this.flights.length +
			this.#pendingLevels.length
		) {
			this.#arm();
		}
	}

	#settle({ nodeId, value, capacity }: Held & { kind: 'level' }, now: number) {
		const applyAt = Math.max(now, this.#landsAt.get(nodeId) ?? 0);
		this.#pendingLevels.push({ nodeId, value, capacity, applyAt });
	}

	#launch({ count, from, to, lane }: Held & { kind: 'hop' }, now: number) {
		const forward = this.#services.edgeBetween(from, to);
		const edgeId = forward ?? this.#services.edgeBetween(to, from);
		if (!edgeId) return;
		const startedAt = Math.max(now, this.#landsAt.get(from) ?? 0);
		this.#landsAt.set(to, Math.max(this.#landsAt.get(to) ?? 0, startedAt + TRAVEL_MS));
		const onEdge = (flight: Flight) => flight.edgeId === edgeId;
		// Dots are illustration and the metrics are the record, so a flood is thinned
		if (
			this.flights.filter(onEdge).length + this.#waiting.filter(onEdge).length >=
			MAX_FLIGHTS_PER_EDGE
		) {
			return;
		}
		const reverse = forward === undefined;
		this.#waiting.push({ id: this.#nextId++, edgeId, reverse, lane, startedAt, count });
	}
}
