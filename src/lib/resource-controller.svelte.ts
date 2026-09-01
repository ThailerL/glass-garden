import type { Node } from '@xyflow/svelte';
import type { Vivari } from '@vivari/core';
import { toast } from 'svelte-sonner';
import type { Upstream, Instance, ResourceDefinition, ResourceStatus } from './resources';
import { mountNodeFiles } from './container';
import { nodeFiles } from './files/node-files';
import { nodeName } from './graph-state.svelte';
import { messageOf } from './errors';
import { ResourceLog } from './resource-log.svelte';

const MAX_FAILED_DEPLOYMENTS = 3;
// Before a crashed instance is respawned
const RESTART_DELAY_MS = 2000;

// Instances carry the stamp rather than the config itself, so staleness is one comparison
const stampOf = (launchConfig: unknown) => JSON.stringify(launchConfig ?? null);

// What an instance would be launched with and the stamp it carries - the only definition
// of both, so the form's bounce prediction cannot drift from the reconciler's comparison
export function launchPlan(
	definition: ResourceDefinition,
	node: Node | undefined,
	upstreams: readonly Upstream[]
): LaunchPlan {
	const config = node ? definition.launchConfig?.(node, upstreams) : undefined;
	return { config, stamp: stampOf(config) };
}

type LaunchPlan = { config: unknown; stamp: string };

// The cross-node concerns a controller can't own itself: the graph, the shared
// container, global port uniqueness and reaching other controllers
export type ControllerServices = {
	getNode: () => Node | undefined;
	getContainer: () => Promise<Vivari>;
	// A port for a new instance, free of whatever this node's live instances are on
	takePort: () => number;
	reconcileReservations: () => void;
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
	readonly log = new ResourceLog();

	#services: ControllerServices;
	#dirty = false;
	#converging = false;
	// What dependents last saw, so they are only rescheduled on real change
	#lastEndpoints: number[] = [];
	// Consecutive deployments that never got an instance running; at the cap the
	// reconciler stops respawning so a broken command doesn't loop forever
	#failedDeployments = $state(0);
	// Numbers deployments, so the instances of one can be told from the next
	#deployments = 0;
	// The deployment that last spent from the budget, so it is charged only once
	#lastFailedDeployment = 0;
	// The launch config that has already interrupted the user, so a broken one is news once
	#toastedStamp: string | undefined;
	// Whether the last update failed, so it interrupts on the way in rather than every pass
	#updateFailed = false;
	// The same, for kills that don't land: stopping a whole pool of them is one complaint
	#stopFailed = false;
	// The newest crash, which the restart delay runs from
	#lastCrashAt = 0;
	#restartTimer = $state<ReturnType<typeof setTimeout> | undefined>(undefined);
	#forgotten = false;
	#abandoned = false;

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
	// reviving crashed instances. Count and config mismatches self-heal
	get canStart(): boolean {
		return !this.wantsRunning || this.instances.some((instance) => instance.status === 'crashed');
	}

	// Instances while not wantsRunning are still winding down or unresponsive, and
	// another stop retries the kill
	get canStop(): boolean {
		return this.wantsRunning || this.instances.some((instance) => instance.status !== 'stopping');
	}

	get restartsPaused(): boolean {
		return this.wantsRunning && this.#failedDeployments >= MAX_FAILED_DEPLOYMENTS;
	}

	get restartPending(): boolean {
		return this.#restartTimer !== undefined;
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
		this.#failedDeployments = 0;
		// Asked for explicitly, so it does not sit out the delay of an earlier crash
		this.#lastCrashAt = 0;
		// Retrying unchanged config is worth an answer, even if it is the same failure
		this.#toastedStamp = undefined;
		this.#cancelRestart();
		// Dropped here so the pass fills empty slots rather than counting a recovery
		this.#dropCrashed();
		this.wantsRunning = true;
		this.schedule();
	}

	stop() {
		this.#standDown();
		this.schedule();
	}

	// Shared by every wind-down: stop wanting instances and drop any pending restart
	#standDown() {
		this.wantsRunning = false;
		this.#cancelRestart();
	}

	// Called once the node is gone from the graph; winds down and unregisters after the
	// last instance
	forget() {
		this.#forgotten = true;
		this.stop();
	}

	// Called when the container is going away, which kills every process in it: nothing here
	// can be stopped gracefully any more. Unlike forget(), the node stays, so its files do too
	abandon() {
		this.#abandoned = true;
		this.#standDown();
		// The processes died with the container, so the slots are dropped rather than stopped
		this.instances = [];
	}

	// Every trigger funnels through here. At most one pass runs at a time; anything landing
	// mid-pass makes the loop go around again with fresh state, so concurrent actions are safe
	schedule() {
		if (this.#abandoned) return;
		this.#dirty = true;
		if (this.#converging) return;
		this.#converging = true;
		this.#converge()
			// The pass is left where it stopped, so nothing moves until the next trigger
			.catch((e) => {
				toast.error(`${this.#nodeName()} stopped applying changes`);
				this.log.event('resource', 'error', `Failed to apply changes, left as is: ${messageOf(e)}`);
			})
			.finally(() => (this.#converging = false));
	}

	async #converge() {
		while (this.#dirty && !this.#abandoned) {
			this.#dirty = false;
			await this.#reconcilePass();
		}
		// An abandoned node is still on its canvas; unregistering would take its files with it
		if (this.#forgotten && !this.#abandoned && this.instances.length === 0) {
			this.#services.unregister();
		}
	}

	async #reconcilePass() {
		// Read fresh from the graph every pass so a config edit can't go stale in a copy
		const node = this.#services.getNode();
		const desired = this.wantsRunning && node ? this.#definition.instanceCount(node) : 0;
		// Built once and handed to start, so an instance launches with what it is stamped with
		const upstreams = this.#services.getUpstreams();
		const launch = launchPlan(this.#definition, node, upstreams);

		// Whatever the deficit step puts up after a slot was freed is a replacement rather
		// than a first start
		const replacing = this.#freeCrashedSlots(desired);

		// Surplus from a scale-down, plus stale instances bounced to pick up new launch config
		const doomed = this.instances.filter(
			(instance, index) => index >= desired || instance.configStamp !== launch.stamp
		);
		if (doomed.length > 0) {
			// Otherwise the stops and starts that follow read exactly like a crash and restart
			const stale = doomed.filter((instance) => instance.configStamp !== launch.stamp).length;
			this.log.event(
				'resource',
				'info',
				stale > 0
					? `Config changed, replacing ${stale} instance${stale === 1 ? '' : 's'}`
					: `Scaling down to ${desired} instance${desired === 1 ? '' : 's'}`
			);
		}
		await Promise.all(doomed.map((instance) => this.#stopInstance(instance)));

		if (node && this.instances.length < desired) {
			await this.#spawnDeficit(node, desired, upstreams, launch, replacing);
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
				this.#updateFailed = false;
			} catch (e) {
				// A resource that can't be reconfigured keeps its old config
				if (!this.#updateFailed) {
					toast.error(`${this.#nodeName()} could not be reconfigured`);
				}
				this.#updateFailed = true;
				this.log.event('resource', 'error', `Failed to update: ${messageOf(e)}`);
			}
		}

		this.#services.reconcileReservations();
		this.#notifyDependents();
	}

	// Auto-restart: drops crashed instances so the deficit step refills their slots, charging
	// the incident one restart however many died. Skipped at the cap, leaving the pool visibly
	// crashed; a config fix still recovers via the stale check. Says whether it freed anything
	#freeCrashedSlots(desired: number): boolean {
		if (this.#failedDeployments >= MAX_FAILED_DEPLOYMENTS) return false;
		if (!this.instances.some((instance) => instance.status === 'crashed')) return false;
		// They stay visibly crashed until the delay is out. It runs from the newest crash,
		// so siblings that die together are respawned as one deployment
		const wait = this.wantsRunning ? this.#lastCrashAt + RESTART_DELAY_MS - Date.now() : 0;
		if (wait > 0) {
			this.#restartLater(wait);
			return false;
		}
		this.#dropCrashed();
		if (desired > 0) this.restarts += 1;
		return true;
	}

	// A crashed instance owns nothing any more, so its slot is dropped rather than stopped
	#dropCrashed() {
		this.instances = this.instances.filter((instance) => instance.status !== 'crashed');
	}

	async #spawnDeficit(
		node: Node,
		desired: number,
		upstreams: readonly Upstream[],
		launch: LaunchPlan,
		replacing: boolean
	) {
		const pending: Instance[] = [];
		// Everything this pass puts up is one deployment, however many instances that is
		const deployment = ++this.#deployments;
		while (this.instances.length < desired) {
			const index =
				this.instances.push({
					port: this.#services.takePort(),
					status: 'starting',
					configStamp: launch.stamp,
					deployment,
					replacement: replacing,
					startedAt: Date.now()
				}) - 1;
			// Read back so we hold the reactive proxy rather than the object we pushed
			pending.push(this.instances[index]);
		}

		try {
			const container = await this.#services.getContainer();
			await mountNodeFiles(this.nodeId, nodeFiles(node), !this.#definition.hasEditableFiles);
			// Runs once per pass rather than once per instance, so instances don't race each other
			await this.#definition.prepare?.(node, container, (output) =>
				this.log.capture('resource', output)
			);
			await Promise.all(
				pending.map((instance) =>
					this.#spawnInstance(node, container, upstreams, launch.config, instance)
				)
			);
		} catch (e) {
			// Only group-wide failures land here (boot, mount, npm install) - per-instance
			// failures are recorded inside #spawnInstance
			for (const instance of pending) instance.status = 'crashed';
			this.#toastOnce(launch.stamp, `${this.#nodeName()} could not be set up`);
			this.log.event('resource', 'error', `Failed to set up: ${messageOf(e)}`);
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
			if (handle.output) this.log.capture(instance.port, handle.output);
			// Server-hosting resources stay 'starting' until server-ready promotes them
			if (this.#definition.readyOnStart) instance.status = 'running';
			this.log.event(instance.port, 'info', 'Instance started');
			// A rejection means nothing will ever say whether the process is still alive, which is
			// what 'unresponsive' is for: the slot and port stay held rather than respawned over it
			handle.exited.then(
				(code) => this.#onExit(instance, code),
				(e) => {
					// A stop is waiting on the same rejection and reports it as a failed kill
					if (instance.status === 'stopping') return;
					instance.status = 'unresponsive';
					toast.error(`Lost contact with an instance of ${this.#nodeName()}`);
					this.log.event(instance.port, 'error', `Lost contact with instance: ${messageOf(e)}`);
				}
			);
		} catch (e) {
			instance.status = 'crashed';
			this.#toastOnce(instance.configStamp, `${this.#nodeName()} could not be started`);
			this.log.event(instance.port, 'error', `Instance failed to start: ${messageOf(e)}`);
		}
	}

	#onExit(instance: Instance, code: number) {
		instance.previewUrl = undefined;
		instance.handle = undefined;
		// A deliberate stop sets 'stopping' first, so a live status here means a crash
		if (instance.status !== 'starting' && instance.status !== 'running') return;
		const neverRan = instance.status === 'starting';
		instance.status = 'crashed';
		this.#lastCrashAt = Date.now();
		this.log.event(instance.port, 'warning', `Instance crashed (exit ${code})`);

		// The rest of a deployment crashing tells us nothing new, so only its first
		// casualty spends from the budget
		const firstOfDeployment = neverRan && instance.deployment !== this.#lastFailedDeployment;
		if (firstOfDeployment) {
			this.#lastFailedDeployment = instance.deployment;
			this.#failedDeployments++;
		}

		const capped = this.#failedDeployments >= MAX_FAILED_DEPLOYMENTS;
		if (firstOfDeployment && capped) {
			this.log.event(
				'resource',
				'error',
				'Restarts paused - instances kept crashing before coming up'
			);
			if (this.wantsRunning) {
				toast.error(`${this.#nodeName()} keeps crashing - restarts paused`);
			}
		} else if (this.wantsRunning && !capped) {
			// A config that has already said it cannot come up stays in the log. One that was
			// running until now cleared the latch when it came up, so it still interrupts
			this.#toastOnce(
				instance.configStamp,
				`Instance of ${this.#nodeName()} crashed - restarting`,
				'warning'
			);
		}
		this.schedule();
	}

	// One pending timer is enough: the pass it brings back recomputes what is left to wait,
	// so crashes landing in the meantime only extend it
	#restartLater(wait: number) {
		if (this.#restartTimer !== undefined) return;
		this.#restartTimer = setTimeout(() => {
			this.#restartTimer = undefined;
			this.schedule();
		}, wait);
	}

	#cancelRestart() {
		clearTimeout(this.#restartTimer);
		this.#restartTimer = undefined;
	}

	// Drops the instance once it is gone; a failed kill keeps its slot, its handle and
	// its reserved port so a later pass can retry
	async #stopInstance(instance: Instance) {
		const handle = instance.handle;
		if (handle) {
			instance.status = 'stopping';
			try {
				await handle.stop();
				this.#stopFailed = false;
			} catch (e) {
				instance.status = 'unresponsive';
				if (!this.#stopFailed) toast.error(`${this.#nodeName()} would not stop`);
				this.#stopFailed = true;
				this.log.event(instance.port, 'error', `Instance failed to stop: ${messageOf(e)}`);
				return;
			}
		}
		const index = this.instances.indexOf(instance);
		if (index !== -1) this.instances.splice(index, 1);
		if (handle) this.log.event(instance.port, 'info', 'Instance stopped');
	}

	// A spawned process is not a listening server, so this is the first point at which
	// dependents can be pointed at the instance
	onServerReady(port: number, url: string): boolean {
		const instance = this.instances.find((instance) => instance.port === port);
		if (!instance) return false;
		instance.previewUrl = url;
		if (instance.status === 'starting') {
			instance.status = 'running';
			// An instance coming fully up is proof the config can run, so a later failure of
			// the same config is news again
			this.#failedDeployments = 0;
			this.#toastedStamp = undefined;
			this.log.event(port, 'info', 'Instance running');
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
		return node ? nodeName(node) : this.#definition.name;
	}

	// Interrupts once per launch config: a broken one is one piece of news however often it
	// is redeployed. Editing the config makes it news again; the log keeps the rest
	#toastOnce(stamp: string, message: string, level: 'error' | 'warning' = 'error') {
		if (this.#toastedStamp === stamp) return;
		this.#toastedStamp = stamp;
		toast[level](message);
	}
}
