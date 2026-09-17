import { describe, expect, it } from 'vitest';
import { fileTree } from './file-tree';

describe('fileTree', () => {
	it('nests paths into directories, keeping bytes', () => {
		const bytes = new Uint8Array([0xff]);
		expect(fileTree({ 'server.js': 'hi', 'lib/util.js': 'util', 'lib/deep/b.bin': bytes })).toEqual(
			{
				'server.js': { file: { contents: 'hi' } },
				lib: {
					directory: {
						'util.js': { file: { contents: 'util' } },
						deep: { directory: { 'b.bin': { file: { contents: bytes } } } }
					}
				}
			}
		);
	});

	it('rejects a path that runs through a file', () => {
		expect(() => fileTree({ a: 'x', 'a/b': 'y' })).toThrow('a/b is under a file');
	});
});
