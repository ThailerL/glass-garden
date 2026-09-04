import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/svelte';
import type { ConnectedNode, Instance } from '../types';
import { targetPort } from './index';

const connected = (type: string, ...statuses: Instance['status'][]): ConnectedNode => ({
	node: { id: type, type, position: { x: 0, y: 0 }, data: { config: {} } } as unknown as Node,
	instances: statuses.map((status, i) => ({ port: 4000 + i, status }) as Instance),
	reservedPorts: []
});

describe('targetPort', () => {
	it('is the first running instance', () => {
		expect(targetPort([connected('instanceGroup', 'starting', 'running', 'running')])).toBe(4001);
	});

	it('is null while nothing is running', () => {
		expect(targetPort([connected('instanceGroup', 'starting', 'crashed')])).toBeNull();
		expect(targetPort([])).toBeNull();
	});

	it('ignores a neighbour that does not serve HTTP', () => {
		expect(
			targetPort([connected('postgres', 'running'), connected('httpLoadBalancer', 'running')])
		).toBe(4000);
	});
});
