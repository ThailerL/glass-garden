import { describe, expect, it } from 'vitest';
import { fileToOpen, fileTree } from './file-tree';

describe('fileToOpen', () => {
	it('opens the entry file, not the one that sorts first', () => {
		expect(fileToOpen(fileTree({ 'package.json': '', 'server.js': '' }))).toEqual(['server.js']);
	});

	it('takes a function handler as an entry file too', () => {
		expect(fileToOpen(fileTree({ 'index.mjs': '', 'package.json': '' }))).toEqual(['index.mjs']);
	});

	// The instance group templates serve a page from public/, which is not what Edit Resource
	// Code was opened for
	it('passes over a page and a stylesheet with the same name', () => {
		const files = fileTree({ 'public/index.html': '', 'main.css': '', 'server.js': '' });
		expect(fileToOpen(files)).toEqual(['server.js']);
	});

	it('prefers a shallow entry file to a nested one', () => {
		const files = fileTree({ 'src/deep/index.js': '', 'main.py': '' });
		expect(fileToOpen(files)).toEqual(['main.py']);
	});

	it('reaches a nested one where nothing at the root matches', () => {
		expect(fileToOpen(fileTree({ 'src/server.ts': '' }))).toEqual(['src', 'server.ts']);
	});

	it('opens nothing where no file looks like an entry', () => {
		expect(fileToOpen(fileTree({ 'notes.md': '' }))).toEqual([]);
	});
});

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
