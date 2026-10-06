import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/svelte';
import type { ConnectedNode, Instance } from '../types';
import { sendingTo } from './index';

const connected = (type: string, ...statuses: Instance['status'][]): ConnectedNode => ({
	node: { id: type, type, position: { x: 0, y: 0 }, data: { config: {} } } as unknown as Node,
	instances: statuses.map((status, i) => ({ port: 4000 + i, status }) as Instance),
	reservedPorts: [],
	isTarget: true
});

describe('sendingTo', () => {
	it("is a group's first running instance, which the generator reports its sends to", () => {
		expect(sendingTo([connected('instanceGroup', 'starting', 'running', 'running')])).toEqual({
			port: 4001,
			reportSends: true
		});
	});

	it('is nothing while nothing is running', () => {
		const nothing = { port: null, reportSends: false };
		expect(sendingTo([connected('instanceGroup', 'starting', 'crashed')])).toEqual(nothing);
		expect(sendingTo([])).toEqual(nothing);
	});

	it('ignores a neighbour it cannot send to, and leaves an endpoint to report its callers', () => {
		expect(
			sendingTo([connected('postgres', 'running'), connected('httpLoadBalancer', 'running')])
		).toEqual({ port: 4000, reportSends: false });
	});
});
