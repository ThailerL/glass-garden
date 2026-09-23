import type { Vivari } from '@vivari/core';

// Vivari implements `node` as this file in the VFS, so a prelude here reaches every process
const LAUNCHER = '/bin/node.js';
const MARKER = 'glass-garden:error-stack-header';

// SpiderMonkey leaves the "Name: message" line off error.stack, so anything that logs a stack
// and nothing else - Express's finalhandler, most user code - gives no reason at all on
// Firefox. V8 keeps stack on the instance, so there is no accessor to wrap and this is inert
const PRELUDE = `// ${MARKER}
{
	const descriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
	if (descriptor && descriptor.get) {
		const inner = descriptor.get;
		Object.defineProperty(Error.prototype, 'stack', {
			configurable: true,
			get() {
				const stack = inner.call(this);
				if (typeof stack !== 'string') return stack;
				const lines = stack.split('\\n').filter((line) => line.trim() !== '');
				const headed = lines.length > 0 && lines[0].startsWith(this.name);
				const frames = headed ? lines.slice(1) : lines;
				// Only the VM's own filesystem is code the reader can open. The rest is the
				// runtime's bundle, served over http, and its WebAssembly
				const readable = frames.filter((line) => line.includes('file://'));
				const hidden = frames.length - readable.length;
				const header = this.message ? this.name + ': ' + this.message : this.name;
				const kept = [headed ? lines[0] : header].concat(readable);
				if (hidden > 0) kept.push('    ... ' + hidden + ' frames inside the runtime');
				return kept.join('\\n');
			},
			set: descriptor.set
		});
	}
}
`;

// The VFS outlives the page, so a launcher already carrying the prelude must be left alone
export function withStackHeader(launcher: string) {
	if (!launcher || launcher.includes(MARKER)) return undefined;
	return PRELUDE + launcher;
}

// The launcher is an internal of @vivari/core rather than its API, so a version that no longer
// has it leaves the VM as it was instead of failing the boot
export async function patchErrorStacks(container: Vivari) {
	const launcher = await container.fs.readFile(LAUNCHER, 'utf-8').catch(() => '');
	const patched = withStackHeader(launcher);
	if (patched) await container.fs.writeFile(LAUNCHER, patched);
}
