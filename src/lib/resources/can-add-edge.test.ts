import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/svelte';
import { canAddEdge } from './index';

const node = (id: string, type: string): Node =>
	({ id, type, position: { x: 0, y: 0 }, data: { config: {} } }) as unknown as Node;

const edge = (source: string, target: string): Edge => ({
	id: `${source}-${target}`,
	source,
	target
});

const generator = node('generator', 'requestGenerator');
const balancer = node('balancer', 'httpLoadBalancer');
const app = node('app', 'instanceGroup');
const database = node('database', 'postgres');

describe('canAddEdge', () => {
	it('refuses what the capabilities refuse', () => {
		expect(canAddEdge(generator, database, [])).toBe(false);
		expect(canAddEdge(generator, balancer, [])).toBe(true);
	});

	it('refuses a second target for a source that acts on one', () => {
		expect(canAddEdge(generator, app, [edge('generator', 'balancer')])).toBe(false);
	});

	it('lets a source that acts on one redraw its existing edge', () => {
		expect(canAddEdge(generator, balancer, [edge('generator', 'balancer')])).toBe(true);
	});

	it('lets every other source point at several things', () => {
		expect(canAddEdge(balancer, app, [edge('balancer', 'other-app')])).toBe(true);
	});

	it('ignores edges out of other nodes', () => {
		expect(canAddEdge(generator, balancer, [edge('balancer', 'app')])).toBe(true);
	});
});
