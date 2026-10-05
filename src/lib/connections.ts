import type { ConnectionEvent } from '@vivari/core';

// Who dialled each connection a server in the VM accepted, by the port the server sees it from
export class Connections {
	#clients = new Map<number, number[]>();
	// Never forgotten: the VM does not hand a pid out twice
	#owners = new Map<number, string>();

	own(pid: number, nodeId: string) {
		this.#owners.set(pid, nodeId);
	}

	// A port is only reused once its connection has closed, so the newest holder is the live one
	opened({ remotePort, remotePid, remoteAncestors }: ConnectionEvent) {
		this.#clients.set(remotePort, [remotePid, ...remoteAncestors]);
	}

	// The dialler's node, or that of the nearest process that started it
	nodeAt(remotePort: number): string | undefined {
		for (const pid of this.#clients.get(remotePort) ?? []) {
			const nodeId = this.#owners.get(pid);
			if (nodeId !== undefined) return nodeId;
		}
		return undefined;
	}
}
