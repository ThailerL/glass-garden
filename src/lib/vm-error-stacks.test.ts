import { describe, expect, it } from 'vitest';
import { withStackHeader } from './vm-error-stacks';

describe('withStackHeader', () => {
	it('prepends the prelude to a launcher it has not seen', () => {
		const patched = withStackHeader('const path = require("path");');
		expect(patched).toMatch(/const path = require\("path"\);$/);
	});

	it('leaves an already patched launcher alone', () => {
		const patched = withStackHeader('const path = require("path");');
		expect(withStackHeader(patched!)).toBeUndefined();
	});

	it('does nothing when the launcher is missing', () => {
		expect(withStackHeader('')).toBeUndefined();
	});
});

// The prelude only does anything on an engine that keeps stack on Error.prototype, which is
// not the one vitest runs on, so the accessor it wraps is staged here
describe('the prelude it prepends', () => {
	function runAgainstAPrototypeAccessor(stack: string) {
		const original = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
		Object.defineProperty(Error.prototype, 'stack', {
			configurable: true,
			get() {
				return stack;
			},
			set() {}
		});
		try {
			new Function(withStackHeader('0;')!)();
			const error = new Error('instancePort is not defined');
			// V8 gives every instance its own stack, which would shadow the wrapped accessor
			delete (error as unknown as Record<string, unknown>).stack;
			return error.stack;
		} finally {
			if (original) Object.defineProperty(Error.prototype, 'stack', original);
			else delete (Error.prototype as unknown as Record<string, unknown>).stack;
		}
	}

	it('puts the name and message above the frames', () => {
		expect(runAgainstAPrototypeAccessor('@file:///probe/server.js:4:43')).toBe(
			'Error: instancePort is not defined\n@file:///probe/server.js:4:43'
		);
	});

	it('keeps a header the engine already wrote', () => {
		const stack = 'Error: instancePort is not defined\n@file:///probe/server.js:4:43';
		expect(runAgainstAPrototypeAccessor(stack)).toBe(stack);
	});

	it('drops the frames outside the VM and counts them', () => {
		const stack = [
			'@file:///probe/server.js:4:43',
			'handleRequest@http://localhost:3100/assets/process-worker-Do4GxeIj.js:9854:27',
			'@http://localhost:3100/assets/process-worker-Do4GxeIj.js line 3265 > WebAssembly.Module:wasm-function[10]:0x571'
		].join('\n');
		expect(runAgainstAPrototypeAccessor(stack)).toBe(
			[
				'Error: instancePort is not defined',
				'@file:///probe/server.js:4:43',
				'    ... 2 frames inside the runtime'
			].join('\n')
		);
	});
});
