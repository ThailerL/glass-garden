import type { Node } from '@xyflow/svelte';
import type { Vivari } from '@vivari/core';
import { toast } from 'svelte-sonner';
import type { Upstream, Instance, ResourceDefinition, ResourceStatus } from './resources';
import { mountNodeFiles } from './container';
import { nodeConfig } from './graph-state.svelte';

const MAX_EVENTS = 50;
const MAX_FAILED_STARTS = 3;

// Instances carry the stamp rather than the config itself, so staleness is one comparison
export const stampOf = (launchConfig: unknown) => JSON.stringify(launchConfig ?? null);

export type ResourceEvent = {
	time: number;
	level: 'info' | 'warning' | 'error';
	message: string;
};

// The cross-node concerns a controller can't own itself: the graph, the shared
// container, global port uniqueness and reaching other controllers
export type ControllerServices = {
	getNode: () => Node | undefined;
	getContainer: () => Promise<Vivari>;
	// A port for a new instance, free of whatever this node's live instances are on
	takePort: () => number;
	getUpstreams: () => readonly Upstream[];
	scheduleDependents: () => void;
	unregister: () => void;
};

// Reconciles one node: converges its actual instances toward desired state, where
// desired is wantsRunning plus whatever the node's current config says
export class ResourceController {
	readonly nodeId: string;
	// Kept here rather than looked up, so instances can still be stopped after the
	// node is deleted from the graph
	readonly #definition: ResourceDefinition;

	wantsRunning = $state(false);
	instances = $state<Instance[]>([]);
	// Auto-restarts since the last explicit start
	restarts = $state(0);
	// Newest first
	events = $state<ResourceEvent[]>([]);

	#services: ControllerServices;
	#dirty = false;
	#converging = false;
	// What dependents last saw, so they are only rescheduled on real change
	#lastEndpoints: number[] = [];
	// Consecutive crashes of instances that never became running; at the cap the
	// reconciler stops respawning so a broken command doesn't loop forever
	#failedStarts = 0;
	#forgotten = false;

	constructor(nodeId: string, definition: ResourceDefinition, services: ControllerServices) {
		this.nodeId = nodeId;
		this.#definition = definition;
		this.#services = services;
	}

	get status(): ResourceStatus {
		if (this.instances.length === 0) return 'stopped';
		if (this.instances.every((instance) => instance.status === 'running')) return 'running';
		// Transitional states first, so converging shows as movement rather than damage
		if (this.instances.some((instance) => instance.status === 'starting')) return 'starting';
		if (this.instances.some((instance) => instance.status === 'stopping')) return 'stopping';
		if (this.instances.some((instance) => instance.status === 'unresponsive'))
			return 'unresponsive';
		if (this.instances.some((instance) => instance.status === 'running')) return 'degraded';
		return 'crashed';
	}

	// Start is only useful when it would change desired state: bringing the node up or
	// reviving crashed instances. Count and config mismatches self-heal, so no lock on
	// transitional states is needed
	get canStart(): boolean {
		return !this.wantsRunning || this.instances.some((instance) => instance.status === 'crashed');
	}

	// Instances while not wantsRunning are still winding down or unresponsive, and
	// another stop retries the kill
	get canStop(): boolean {
		return this.wantsRunning || this.instances.some((instance) => instance.status !== 'stopping');
	}

	// A stopping instance still owns its process and its port until the kill lands, so
	// it counts as up and the number ticks down as each one actually dies
	get upCount(): number {
		return this.instances.filter(
			(instance) => instance.status === 'running' || instance.status === 'stopping'
		).length;
	}

	start() {
		this.restarts = 0;
		this.#failedStarts = 0;
		this.wantsRunning = true;
		this.schedule();
	}

	stop() {
		this.wantsRunning = false;
		this.schedule();
	}

	// Called once the node is gone from the graph; winds everything down and
	// unregisters once the last instance is gone
	forget() {
		this.wantsRunning = false;
		this.#forgotten = true;
		this.schedule();
	}

	// Every trigger funnels through here. At most one pass runs at a time; anything
	// landing mid-pass just makes the loop go around again with fresh state, which is
	// what makes concurrent starts, stops and config changes safe
	schedule() {
		this.#dirty = true;
		if (this.#converging) return;
		this.#converging = true;
		this.#converge()
			.catch((e) => console.error(e))
			.finally(() => (this.#converging = false));
	}

	async #converge() {
		while (this.#dirty) {
			this.#dirty = false;
			await this.#reconcilePass();
		}
		if (this.#forgotten && this.instances.length === 0) {
			this.#services.unregister();
		}
	}

	async #reconcilePass() {
		// Read fresh from the graph every pass so a config edit can't go stale in a copy
		const node = this.#services.getNode();
		const desired = this.wantsRunning && node ? this.#definition.instanceCount(node) : 0;
		// Built once and handed to start, so an instance launches with exactly what it is
		// stamped with
		const upstreams = this.#services.getUpstreams();
		const launchConfig = node ? this.#definition.launchConfig?.(node, upstreams) : undefined;
		const configStamp = stampOf(launchConfig);

		// Auto-restart: free the slots of crashed instances so the deficit step below
		// respawns them. Skipped at the failed-start cap, leaving the pool visibly
		// crashed instead of looping; a config fix still recovers via the stale check below
		if (this.#failedStarts < MAX_FAILED_STARTS) {
			const crashed = this.instances.filter((instance) => instance.status === 'crashed');
			if (crashed.length > 0) {
				this.instances = this.instances.filter((instance) => instance.status !== 'crashed');
				if (desired > 0) this.restarts += crashed.length;
			}
		}

		// Surplus from a scale-down, plus stale instances that must be bounced to pick
		// up new launch config
		const doomed = this.instances.filter(
			(instance, index) => index >= desired || instance.configStamp !== configStamp
		);
		await Promise.all(doomed.map((instance) => this.#stopInstance(instance)));

		if (node && this.instances.length < desired) {
			await this.#spawnDeficit(node, desired, upstreams, launchConfig);
		}

		if (node && this.wantsRunning && this.#definition.update) {
			try {
				// Read fresh rather than reusing the pass's upstreams: spawning may have taken a
				// while, and update exists to reflect current topology
				await this.#definition.update(
					node,
					await this.#services.getContainer(),
					this.#services.getUpstreams()
				);
			} catch (e) {
				// A resource that can't be reconfigured keeps its old config
				console.error(e);
			}
		}

		this.#notifyDependents();
	}

	async #spawnDeficit(
		node: Node,
		desired: number,
		upstreams: readonly Upstream[],
		launchConfig: unknown
	) {
		const pending: Instance[] = [];
		const configStamp = stampOf(launchConfig);
		while (this.instances.length < desired) {
			const index =
				this.instances.push({
					port: this.#services.takePort(),
					status: 'starting',
					configStamp
				}) - 1;
			// Read back so we hold the reactive proxy rather than the object we pushed
			pending.push(this.instances[index]);
		}

		try {
			const container = await this.#services.getContainer();
			await mountNodeFiles(this.nodeId, this.#definition.files);
			// Runs once per pass rather than once per instance, so instances don't race each other
			await this.#definition.prepare?.(node, container);
			await Promise.all(
				pending.map((instance) =>
					this.#spawnInstance(node, container, upstreams, launchConfig, instance)
				)
			);
		} catch (e) {
			// Only group-wide failures land here (boot, mount, npm install) - per-instance
			// failures are recorded inside #spawnInstance
			console.error(e);
			for (const instance of pending) instance.status = 'crashed';
			this.#log('error', `Failed to prepare: ${e instanceof Error ? e.message : e}`);
		}
	}

	async #spawnInstance(
		node: Node,
		container: Vivari,
		upstreams: readonly Upstream[],
		launchConfig: unknown,
		instance: Instance
	) {
		try {
			const handle = await this.#definition.start(
				node,
				container,
				instance.port,
				upstreams,
				launchConfig
			);
			instance.handle = handle;
			// Server-hosting resources stay 'starting' until server-ready promotes them
			if (this.#definition.readyOnStart) instance.status = 'running';
			this.#log('info', `Instance on port ${instance.port} started`);
			handle.exited.then(() => this.#onExit(instance));
		} catch (e) {
			console.error(e);
			instance.status = 'crashed';
			this.#log('error', `Instance on port ${instance.port} failed to start`);
		}
	}

	#onExit(instance: Instance) {
		instance.previewUrl = undefined;
		instance.handle = undefined;
		// A deliberate stop sets 'stopping' first, so a live status here means it
		// crashed unexpectedly
		if (instance.status !== 'starting' && instance.status !== 'running') return;
		const neverRan = instance.status === 'starting';
		instance.status = 'crashed';
		this.#log('warning', `Instance on port ${instance.port} crashed`);

		if (neverRan) this.#failedStarts++;
		if (this.#failedStarts === MAX_FAILED_STARTS) {
			this.#log('error', 'Instances keep crashing before coming up — restarts paused');
			if (this.wantsRunning) {
				toast.error(`${this.#nodeName()} is crash-looping — restarts paused`);
			}
		} else if (this.wantsRunning && (!neverRan || this.#failedStarts === 1)) {
			// Only the first failed start of a streak toasts; later ones stay in the log
			toast.warning(`Instance of ${this.#nodeName()} crashed — restarting`);
		}
		this.schedule();
	}

	// Drops the instance once it is gone; a failed kill keeps its slot, its handle and
	// its reserved port so a later pass can retry
	async #stopInstance(instance: Instance) {
		const handle = instance.handle;
		if (handle) {
			instance.status = 'stopping';
			try {
				await handle.stop();
			} catch (e) {
				console.error(e);
				instance.status = 'unresponsive';
				this.#log('error', `Instance on port ${instance.port} failed to stop`);
				return;
			}
		}
		const index = this.instances.indexOf(instance);
		if (index !== -1) this.instances.splice(index, 1);
		if (handle) this.#log('info', `Instance on port ${instance.port} stopped`);
	}

	// A spawned process is not a listening server, so this is the first point at which
	// dependents can be pointed at the instance
	onServerReady(port: number, url: string): boolean {
		const instance = this.instances.find((instance) => instance.port === port);
		if (!instance) return false;
		instance.previewUrl = url;
		if (instance.status === 'starting') {
			instance.status = 'running';
			// An instance coming fully up is proof the config can run
			this.#failedStarts = 0;
			this.#log('info', `Instance on port ${port} running`);
			this.schedule();
		}
		return true;
	}

	#notifyDependents() {
		const endpoints = this.instances
			.filter((instance) => instance.status === 'running')
			.map((instance) => instance.port)
			.sort((a, b) => a - b);
		if (endpoints.join(',') === this.#lastEndpoints.join(',')) return;
		this.#lastEndpoints = endpoints;
		this.#services.scheduleDependents();
	}

	// Falls back to the resource's own name once the node is gone from the graph
	#nodeName() {
		const node = this.#services.getNode();
		return node ? nodeConfig<{ name: string }>(node).name : this.#definition.name;
	}

	#log(level: ResourceEvent['level'], message: string) {
		this.events.unshift({ time: Date.now(), level, message });
		if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
	}
}
