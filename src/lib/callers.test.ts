import { describe, expect, it } from 'vitest';
import { Callers } from '$lib/callers';

// web's instance runs as pid 10, under npm (9) and a shell (8); the region is 20
const instances: Record<number, string> = { 10: 'web' };
const connection = (remotePort: number, remotePid: number, remoteAncestors: number[] = []) => ({
	port: 5432,
	remotePort,
	pid: 30,
	remotePid,
	remoteAncestors
});

describe('Callers', () => {
	it('names the node whose instance opened the connection', () => {
		const callers = new Callers((pid) => instances[pid]);
		callers.connected(connection(49152, 10));
		expect(callers.nodeAt(49152)).toBe('web');
	});

	it('finds the instance above a child process it started', () => {
		const callers = new Callers((pid) => instances[pid]);
		callers.connected(connection(49153, 11, [10, 9, 8]));
		expect(callers.nodeAt(49153)).toBe('web');
	});

	it('names nothing for a process no node started, such as a terminal', () => {
		const callers = new Callers((pid) => instances[pid]);
		callers.connected(connection(49154, 40, [39]));
		expect(callers.nodeAt(49154)).toBeUndefined();
		expect(callers.nodeAt(60000)).toBeUndefined();
	});

	it('names the function whose execution environment opened the connection', () => {
		const callers = new Callers((pid) => instances[pid]);
		callers.environmentSpawned(21, 'fn', 'a1b2c3d4');
		callers.connected(connection(49155, 21, [20]));
		expect(callers.nodeAt(49155)).toBe('fn');
		callers.environmentExited('a1b2c3d4');
		expect(callers.nodeAt(49155)).toBeUndefined();
	});

	it('follows a port to the connection that holds it now', () => {
		const callers = new Callers((pid) => instances[pid]);
		callers.environmentSpawned(21, 'fn', 'a1b2c3d4');
		callers.connected(connection(49156, 21));
		callers.connected(connection(49156, 10));
		expect(callers.nodeAt(49156)).toBe('web');
	});
});
