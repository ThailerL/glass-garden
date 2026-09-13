import { describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/svelte';
import type { ConnectedNode } from '../types';

vi.mock('$lib/container', () => ({
	getContainer: vi.fn(),
	onContainerShutdown: vi.fn(),
	activeProjectDirectory: () => '/project',
	nodeDirectory: (id: string) => `/project/nodes/${id}`
}));

// Through the registry rather than this directory: the definition reads its neighbours'
// definitions, which only exist once the registry has been built
import { resourceDefinitions } from '$lib/resources';

const { lambdaFunction } = resourceDefinitions;

const node = (id: string, type: string, config: Record<string, unknown>): Node =>
	({ id, type, position: { x: 0, y: 0 }, data: { config } }) as unknown as Node;

const connected = (node: Node): ConnectedNode =>
	({ node, instances: [{ status: 'running' }], reservedPorts: [4100] }) as unknown as ConnectedNode;

describe('lambdaFunction.launchConfig', () => {
	// A function among the neighbours is a caller granted by the topology, not an event source
	it('maps a queue pointing at it and ignores a function that invokes it', () => {
		const target = node('f', 'lambdaFunction', {
			name: 'Worker',
			functionName: 'worker',
			timeout: 30,
			maxConcurrency: 5
		});
		const neighbours = [
			connected(node('q', 'sqsQueue', { name: 'Jobs', queueName: 'jobs', visibilityTimeout: 30 })),
			connected(
				node('c', 'lambdaFunction', {
					name: 'Caller',
					functionName: 'caller',
					timeout: 3,
					maxConcurrency: 5
				})
			)
		];
		const config = lambdaFunction.launchConfig(target, neighbours);
		expect(config).toMatchObject({ timeout: 30, maxConcurrency: 5, queues: ['jobs'] });
		expect(config.env).toMatchObject({ AWS_LAMBDA_FUNCTION_NAME: 'worker' });
	});
});
