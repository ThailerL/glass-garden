import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/svelte';
import { unreachable, type ConnectionState } from './ResourceNode.svelte';

const dragging = (fromId: string, fromType: string, handle: 'source' | 'target') =>
	({
		inProgress: true,
		fromNode: { id: fromId, type: fromType },
		fromHandle: { type: handle }
	}) as unknown as ConnectionState;

const idle = { inProgress: false } as unknown as ConnectionState;

const edge = (source: string, target: string): Edge => ({
	id: `${source}-${target}`,
	source,
	target
});

const balancer = { id: 'balancer', type: 'httpLoadBalancer' };
const app = { id: 'app', type: 'instanceGroup' };
const database = { id: 'database', type: 'postgres' };

describe('unreachable', () => {
	it('dims nothing while no connection is being dragged', () => {
		expect(unreachable(idle, database, [])).toBe(false);
	});

	it('dims what a drag from a source handle could not point at', () => {
		const connection = dragging('balancer', 'httpLoadBalancer', 'source');
		expect(unreachable(connection, app, [])).toBe(false);
		expect(unreachable(connection, database, [])).toBe(true);
	});

	it('judges the other direction when the drag started from a target handle', () => {
		const connection = dragging('app', 'instanceGroup', 'target');
		expect(unreachable(connection, balancer, [])).toBe(false);
		expect(unreachable(connection, database, [])).toBe(true);
	});

	it('dims a source that has already spent its one target', () => {
		const connection = dragging('generator', 'requestGenerator', 'source');
		expect(unreachable(connection, app, [edge('generator', 'balancer')])).toBe(true);
	});

	it('never dims the node the drag started from', () => {
		expect(unreachable(dragging('app', 'instanceGroup', 'source'), app, [])).toBe(false);
	});
});
