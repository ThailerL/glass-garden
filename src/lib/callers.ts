import type { ConnectionEvent } from '@vivari/core';

// Which node opened a connection, for a server that knows only the port the connection came
// from - its socket's remotePort, as a server on a real host would see it. The VM names the
// process behind every connection between processes, and the canvas knows which processes
// are its nodes', so nothing about the caller has to ride in the address it dialled
export class Callers {
	// Keyed by the client's port, which the VM hands out uniquely while a connection is open
	// and reuses after, so a new connection on a port replaces the old one's entry
	#lineages = new Map<number, number[]>();
	// A function's execution environments are the region's children, not processes the
	// canvas started, so the region says which function each one belongs to
	#environments = new Map<number, { nodeId: string; environment: string }>();
	#instanceOwner: (pid: number) => string | undefined;

	constructor(instanceOwner: (pid: number) => string | undefined) {
		this.#instanceOwner = instanceOwner;
	}

	connected({ remotePort, remotePid, remoteAncestors }: ConnectionEvent) {
		this.#lineages.set(remotePort, [remotePid, ...remoteAncestors]);
	}

	environmentSpawned(pid: number, nodeId: string, environment: string) {
		this.#environments.set(pid, { nodeId, environment });
	}

	environmentExited(environment: string) {
		for (const [pid, owner] of this.#environments) {
			if (owner.environment === environment) this.#environments.delete(pid);
		}
	}

	// Nearest process first: an instance's command is often a shell or npm with the server a
	// few processes below it, and an environment is a child of the region, which is no node
	nodeAt(remotePort: number): string | undefined {
		for (const pid of this.#lineages.get(remotePort) ?? []) {
			const nodeId = this.#environments.get(pid)?.nodeId ?? this.#instanceOwner(pid);
			if (nodeId) return nodeId;
		}
		return undefined;
	}
}
