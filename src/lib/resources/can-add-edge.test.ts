import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/svelte';
import { canAddEdge, paletteTypes } from './index';

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
const fn = node('fn', 'lambdaFunction');
const other = node('other', 'lambdaFunction');

describe('canAddEdge', () => {
	it('refuses what the capabilities refuse', () => {
		expect(canAddEdge(generator, database, [])).toBe(false);
		expect(canAddEdge(generator, balancer, [])).toBe(true);
	});

	it('lets code point at the function it invokes, never the other way round', () => {
		expect(canAddEdge(app, fn, [])).toBe(true);
		expect(canAddEdge(fn, other, [])).toBe(true);
		expect(canAddEdge(fn, app, [])).toBe(false);
	});

	// Outside parties are called by code, never sent traffic
	it('lets code call an external API, and nothing send it traffic', () => {
		const api = node('api', 'externalApi');
		expect(canAddEdge(app, api, [])).toBe(true);
		expect(canAddEdge(fn, api, [])).toBe(true);
		expect(canAddEdge(generator, api, [])).toBe(false);
		expect(canAddEdge(balancer, api, [])).toBe(false);
		expect(canAddEdge(api, app, [])).toBe(false);
	});

	it('leaves an external API out of the palette, since only an author puts one down', () => {
		expect(paletteTypes()).not.toContain('externalApi');
		expect(paletteTypes()).toContain('instanceGroup');
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
