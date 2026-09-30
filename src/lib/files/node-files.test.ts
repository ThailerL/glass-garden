import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/svelte';
import { nodeFiles } from './node-files';
import { getResourceDefinition } from '../resources';

const node = { id: 'node-1', type: 'instanceGroup', data: {} } as unknown as Node;

describe('nodeFiles', () => {
	it("runs the resource's own files when nothing was imported for the node", () => {
		expect(nodeFiles(node)).toBe(getResourceDefinition('instanceGroup').files);
	});

	// Otherwise an imported node silently runs the stock scaffold
	it('runs the imported code in place of them', () => {
		const imported = { ...node, data: { code: { 'server.js': 'authored' } } };

		expect(nodeFiles(imported)).toEqual({ 'server.js': { file: { contents: 'authored' } } });
	});
});
