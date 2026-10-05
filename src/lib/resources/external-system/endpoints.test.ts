import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/svelte';
import type { ConnectedNode, Instance } from '../types';
import { endpointsOf } from './index';

const connected = (
	type: string,
	name: string,
	...statuses: Instance['status'][]
): ConnectedNode => ({
	node: { id: name, type, position: { x: 0, y: 0 }, data: { config: { name } } } as unknown as Node,
	instances: statuses.map((status, i) => ({ port: 4000 + i, status }) as Instance),
	reservedPorts: [],
	isTarget: true
});

describe('endpointsOf', () => {
	it("names each node it can send to, with its first running instance's port", () => {
		expect(
			endpointsOf([
				connected('instanceGroup', 'Bank Events', 'starting', 'running'),
				connected('httpLoadBalancer', 'Front Door', 'running')
			])
		).toEqual([
			{ name: 'Bank Events', port: 4001 },
			{ name: 'Front Door', port: 4000 }
		]);
	});

	it('keeps a node with nothing running, so a send to it fails rather than vanishing', () => {
		expect(endpointsOf([connected('lambdaFunction', 'Receipts', 'crashed')])).toEqual([
			{ name: 'Receipts', port: null }
		]);
	});

	it('leaves out a neighbour that does not serve HTTP', () => {
		expect(endpointsOf([connected('postgres', 'Ledger', 'running')])).toEqual([]);
	});
});
