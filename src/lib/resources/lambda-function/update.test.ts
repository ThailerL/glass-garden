import { describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/svelte';
import type { Vivari } from '@vivari/core';
import type { ConnectedNode } from '../types';

vi.mock('$lib/container', () => ({
	getContainer: vi.fn(),
	onContainerShutdown: vi.fn(),
	activeProjectDirectory: () => '/project',
	nodeDirectory: (id: string) => `/project/nodes/${id}`,
	mountSharedFiles: vi.fn()
}));

import { lambdaFunction } from './index';

const node = (id: string, type: string, config: Record<string, unknown>): Node =>
	({ id, type, position: { x: 0, y: 0 }, data: { config } }) as unknown as Node;

const running = (node: Node): ConnectedNode =>
	({ node, instances: [{ status: 'running' }] }) as unknown as ConnectedNode;

describe('lambdaFunction.update', () => {
	// A function among the sources is a caller granted by the topology, not an event source
	it('polls a queue pointing at it and ignores a function that invokes it', async () => {
		const written: string[] = [];
		const container = {
			fs: {
				mkdir: vi.fn(),
				writeFile: vi.fn(async (_path: string, text: string) => void written.push(text))
			}
		} as unknown as Vivari;
		const target = node('f', 'lambdaFunction', {
			name: 'Worker',
			functionName: 'worker',
			timeout: 3,
			maxConcurrency: 5
		});
		const sources = [
			running(node('q', 'sqsQueue', { name: 'Jobs', queueName: 'jobs', visibilityTimeout: 30 })),
			running(
				node('c', 'lambdaFunction', {
					name: 'Caller',
					functionName: 'caller',
					timeout: 3,
					maxConcurrency: 5
				})
			)
		];
		await lambdaFunction.update(target, container, [], sources);
		expect(JSON.parse(written.at(-1)!).triggers).toEqual([
			{ source: 'sqs', queueName: 'jobs', queueUrl: expect.stringMatching(/\/jobs$/) }
		]);
	});
});
