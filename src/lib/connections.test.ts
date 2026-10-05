import { describe, expect, it } from 'vitest';
import { Connections } from './connections';

function connectionsWith(owners: Record<number, string>) {
	const connections = new Connections();
	for (const [pid, nodeId] of Object.entries(owners)) connections.own(Number(pid), nodeId);
	return connections;
}

const connection = (remotePort: number, remotePid: number, remoteAncestors: number[] = []) => ({
	port: 5432,
	pid: 2,
	remotePort,
	remotePid,
	remoteAncestors
});

describe('Connections', () => {
	it.each([
		['whose process dialled', { 7: 'web' }, 'web'],
		['that started the process, when the dialler is a child of it', { 5: 'web' }, 'web'],
		['nearest the dialler, when more than one is in its line', { 5: 'web', 6: 'shell' }, 'shell']
	])('names the node %s', (_, owners, expected) => {
		const connections = connectionsWith(owners);
		connections.opened(connection(49200, 7, [6, 5]));
		expect(connections.nodeAt(49200)).toBe(expected);
	});

	it('names nobody for a port it has not seen, or a process no node owns', () => {
		const connections = connectionsWith({});
		connections.opened(connection(49200, 9));
		expect(connections.nodeAt(49200)).toBeUndefined();
		expect(connections.nodeAt(49201)).toBeUndefined();
	});

	it('names an owner that is only known after the connection opened', () => {
		const connections = connectionsWith({});
		connections.opened(connection(49200, 4));
		connections.own(4, 'function');
		expect(connections.nodeAt(49200)).toBe('function');
	});

	it('follows a port to whoever holds it now', () => {
		const connections = connectionsWith({ 7: 'web', 8: 'worker' });
		connections.opened(connection(49200, 7));
		connections.opened(connection(49200, 8));
		expect(connections.nodeAt(49200)).toBe('worker');
	});
});
