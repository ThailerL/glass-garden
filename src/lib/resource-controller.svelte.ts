import type { Node } from '@xyflow/svelte';
import type { FileSystemTree, Vivari } from '@vivari/core';
import { toast } from 'svelte-sonner';
import type { UpstreamContext, Instance, ResourceDefinition, ResourceStatus } from './resources';
import { mountNodeFiles } from './container';

const MAX_EVENTS = 50;
const MAX_FAILED_STARTS = 3;

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
	loadFiles: () => Promise<FileSystemTree | undefined>;
	allocatePort: () => number;
	getUpstreamContext: () => UpstreamContext;
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
		const configStamp = node
			? JSON.stringify(this.#definition.launchConfig?.(node) ?? null)
			: 'null';

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
			await this.#spawnDeficit(node, desired, configStamp);
		}

		if (node && this.wantsRunning && this.#definition.update) {
			try {
				await this.#definition.update(
					node,
					await this.#services.getContainer(),
					this.#services.getUpstreamContext()
				);
			} catch (e) {
				// A resource that can't be reconfigured keeps its old config
				console.error(e);
			}
		}

		this.#notifyDependents();
	}

	async #spawnDeficit(node: Node, desired: number, configStamp: string) {
		const pending: Instance[] = [];
		while (this.instances.length < desired) {
			const index =
				this.instances.push({
					port: this.#services.allocatePort(),
					status: 'starting',
					configStamp
				}) - 1;
			// Read back so we hold the reactive proxy rather than the object we pushed
			pending.push(this.instances[index]);
		}

		try {
			const container = await this.#services.getContainer();
			const files = await this.#services.loadFiles();
			await mountNodeFiles(this.nodeId, files ?? this.#definition.files);
			// Runs once per pass rather than once per instance, so instances don't race each other
			await this.#definition.prepare?.(node, container);
			const upstreamContext = this.#services.getUpstreamContext();
			await Promise.all(
				pending.map((instance) => this.#spawnInstance(node, container, upstreamContext, instance))
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
		upstreamContext: UpstreamContext,
		instance: Instance
	) {
		try {
			const handle = await this.#definition.start(node, container, instance.port, upstreamContext);
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

	#nodeName() {
		const node = this.#services.getNode();
		return typeof node?.data.name === 'string' ? node.data.name : this.#definition.name;
	}

	#log(level: ResourceEvent['level'], message: string) {
		this.events.unshift({ time: Date.now(), level, message });
		if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
	}
}
