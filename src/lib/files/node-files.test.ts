import { describe, it, expect, beforeEach } from 'vitest';
import type { Node } from '@xyflow/svelte';
import { nodeFiles } from './node-files';
import { storeImportedFiles } from './imported-files';
import { getResourceDefinition } from '../resources';

function makeLocalStorage(): Storage {
	const entries = new Map<string, string>();
	return {
		get length() {
			return entries.size;
		},
		key: (index: number) => [...entries.keys()][index] ?? null,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => void entries.set(key, String(value)),
		removeItem: (key: string) => void entries.delete(key),
		clear: () => entries.clear()
	};
}

beforeEach(() => {
	globalThis.localStorage = makeLocalStorage();
});

const node = { id: 'node-1', type: 'instanceGroup', data: {} } as unknown as Node;

describe('nodeFiles', () => {
	it("runs the resource's own files when nothing was imported for the node", () => {
		expect(nodeFiles(node)).toBe(getResourceDefinition('instanceGroup').files);
	});

	// Otherwise an imported node silently runs the stock scaffold
	it('runs the imported code in place of them', () => {
		storeImportedFiles(node.id, { 'server.js': 'authored' });

		expect(nodeFiles(node)).toEqual({ 'server.js': { file: { contents: 'authored' } } });
	});
});
