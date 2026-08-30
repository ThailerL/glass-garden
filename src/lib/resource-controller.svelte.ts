import type { Node } from '@xyflow/svelte';
import type { Vivari } from '@vivari/core';
import { toast } from 'svelte-sonner';
import type { Upstream, Instance, ResourceDefinition, ResourceStatus } from './resources';
import { mountNodeFiles } from './container';
import { nodeConfig } from './graph-state.svelte';

const MAX_EVENTS = 50;
const MAX_OUTPUT_LINES = 500;
const MAX_FAILED_DEPLOYMENTS = 3;
// Before a crashed instance is respawned
const RESTART_DELAY_MS = 2000;

// Instances carry the stamp rather than the config itself, so staleness is one comparison
const stampOf = (launchConfig: unknown) => JSON.stringify(launchConfig ?? null);

// Everything thrown at this layer ends up in the node's log, where the reason is the
// whole point of the entry
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// What an instance of this node would be launched with, and the stamp it would carry. The
// only definition of both, so the config form's prediction of a bounce cannot drift from
// the comparison the reconciler actually makes
export function launchPlan(
	definition: ResourceDefinition,
	node: Node | undefined,
	upstreams: readonly Upstream[]
): LaunchPlan {
	const config = node ? definition.launchConfig?.(node, upstreams) : undefined;
	return { config, stamp: stampOf(config) };
}

type LaunchPlan = { config: unknown; stamp: string };

// What produced an entry: an instance, named by its port, or 'resource' for work the node
// did around them, such as installing dependencies
export type LogSource = number | 'resource';

// Everything a node has to say, whoever said it. Shared rather than repeated, because it
// is these three fields meaning the same thing in both that lets the two be sorted into
// one stream and filtered by one source
type LogEntry = {
	time: number;
	source: LogSource;
	text: string;
};

// Both tagged rather than told apart by which fields they carry, which breaks as soon as
// the two are given one in common

// A line a process printed
export type OutputLine = LogEntry & { kind: 'output' };

// Something the orchestrator did, which carries a severity printed output cannot
export type ResourceEvent = LogEntry & { kind: 'event'; level: 'info' | 'warning' | 'error' };

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
	// Both oldest first, the order they happened in
	events = $state<ResourceEvent[]>([]);
	output = $state<OutputLine[]>([]);

	#services: ControllerServices;
	#dirty = false;
	#converging = false;
	// What dependents last saw, so they are only rescheduled on real change
	#lastEndpoints: number[] = [];
	// Consecutive deployments that never got an instance running; at the cap the
	// reconciler stops respawning so a broken command doesn't loop forever
	#failedDeployments = 0;
	// Numbers deployments, so the instances of one can be told from the next
	#deployments = 0;
	// The deployment that last spent from the budget, so it is charged only once
	#lastFailedDeployment = 0;
	// The newest crash, which the restart delay runs from
	#lastCrashAt = 0;
	#restartTimer: ReturnType<typeof setTimeout> | undefined;
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
		this.#failedDeployments = 0;
		// Asked for explicitly, so it does not sit out the delay of an earlier crash
		this.#lastCrashAt = 0;
		this.#cancelRestart();
		this.wantsRunning = true;
		this.schedule();
	}

	stop() {
		this.wantsRunning = false;
		this.#cancelRestart();
		this.schedule();
	}

	// Called once the node is gone from the graph; winds everything down and
	// unregisters once the last instance is gone
	forget() {
		this.#forgotten = true;
		this.stop();
	}

	// Every trigger funnels through here. At most one pass runs at a time; anything
	// landing mid-pass just makes the loop go around again with fresh state, which is
	// what makes concurrent starts, stops and config changes safe
	schedule() {
		this.#dirty = true;
		if (this.#converging) return;
		this.#converging = true;
		this.#converge()
			// The pass is abandoned where it stopped, so nothing moves until the next trigger
			.catch((e) =>
				this.#logEvent('resource', 'error', `Failed to reconcile, left as is: ${messageOf(e)}`)
			)
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
		const launch = launchPlan(this.#definition, node, upstreams);

		// Auto-restart: free the slots of crashed instances so the deficit step below
		// respawns them. Skipped at the failed-deployment cap, leaving the pool visibly
		// crashed instead of looping; a config fix still recovers via the stale check below
		if (this.#failedDeployments < MAX_FAILED_DEPLOYMENTS) {
			const crashed = this.instances.filter((instance) => instance.status === 'crashed');
			if (crashed.length > 0) {
				// They stay visibly crashed until the delay is out. It runs from the newest crash,
				// so siblings that die together are respawned as one deployment
				const wait = this.wantsRunning ? this.#lastCrashAt + RESTART_DELAY_MS - Date.now() : 0;
				if (wait > 0) {
					this.#restartLater(wait);
				} else {
					this.instances = this.instances.filter((instance) => instance.status !== 'crashed');
					if (desired > 0) this.restarts += crashed.length;
				}
			}
		}

		// Surplus from a scale-down, plus stale instances that must be bounced to pick
		// up new launch config
		const doomed = this.instances.filter(
			(instance, index) => index >= desired || instance.configStamp !== launch.stamp
		);
		if (doomed.length > 0) {
			// Otherwise the stops and starts that follow read exactly like a crash and restart
			const stale = doomed.filter((instance) => instance.configStamp !== launch.stamp).length;
			this.#logEvent(
				'resource',
				'info',
				stale > 0
					? `Config changed, replacing ${stale} instance${stale === 1 ? '' : 's'}`
					: `Scaling down to ${desired} instance${desired === 1 ? '' : 's'}`
			);
		}
		await Promise.all(doomed.map((instance) => this.#stopInstance(instance)));

		if (node && this.instances.length < desired) {
			await this.#spawnDeficit(node, desired, upstreams, launch);
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
				this.#logEvent('resource', 'error', `Failed to update: ${messageOf(e)}`);
			}
		}

		this.#notifyDependents();
	}

	async #spawnDeficit(
		node: Node,
		desired: number,
		upstreams: readonly Upstream[],
		launch: LaunchPlan
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
					deployment
				}) - 1;
			// Read back so we hold the reactive proxy rather than the object we pushed
			pending.push(this.instances[index]);
		}

		try {
			const container = await this.#services.getContainer();
			await mountNodeFiles(this.nodeId, this.#definition.files, !this.#definition.hasEditableFiles);
			// Runs once per pass rather than once per instance, so instances don't race each other
			await this.#definition.prepare?.(node, container, (output) =>
				this.#capture('resource', output)
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
			this.#logEvent('resource', 'error', `Failed to prepare: ${messageOf(e)}`);
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
			if (handle.output) this.#capture(instance.port, handle.output);
			// Server-hosting resources stay 'starting' until server-ready promotes them
			if (this.#definition.readyOnStart) instance.status = 'running';
			this.#logEvent(instance.port, 'info', 'Instance started');
			// A rejection means nothing will ever say whether the process is still alive, which
			// is what 'unresponsive' is for: the slot and its port stay held rather than being
			// respawned over something that may still be running
			handle.exited.then(
				(code) => this.#onExit(instance, code),
				(e) => {
					// A stop is waiting on the same rejection and reports it as a failed kill
					if (instance.status === 'stopping') return;
					instance.status = 'unresponsive';
					this.#logEvent(instance.port, 'error', `Lost track of instance: ${messageOf(e)}`);
				}
			);
		} catch (e) {
			instance.status = 'crashed';
			this.#logEvent(instance.port, 'error', `Instance failed to start: ${messageOf(e)}`);
		}
	}

	#onExit(instance: Instance, code: number) {
		instance.previewUrl = undefined;
		instance.handle = undefined;
		// A deliberate stop sets 'stopping' first, so a live status here means it
		// crashed unexpectedly
		if (instance.status !== 'starting' && instance.status !== 'running') return;
		const neverRan = instance.status === 'starting';
		instance.status = 'crashed';
		this.#lastCrashAt = Date.now();
		this.#logEvent(instance.port, 'warning', `Instance crashed (exit ${code})`);

		// The rest of a deployment crashing tells us nothing new, so only its first
		// casualty spends from the budget
		const firstOfDeployment = neverRan && instance.deployment !== this.#lastFailedDeployment;
		if (firstOfDeployment) {
			this.#lastFailedDeployment = instance.deployment;
			this.#failedDeployments++;
		}

		const capped = this.#failedDeployments >= MAX_FAILED_DEPLOYMENTS;
		if (firstOfDeployment && capped) {
			this.#logEvent(
				'resource',
				'error',
				'Deployments keep crashing before coming up — restarts paused'
			);
			if (this.wantsRunning) {
				toast.error(`${this.#nodeName()} is crash-looping — restarts paused`);
			}
		} else if (this.wantsRunning && !capped && (!neverRan || firstOfDeployment)) {
			// Only the first crash of a deployment toasts; later ones stay in the log
			toast.warning(`Instance of ${this.#nodeName()} crashed — restarting`);
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
			} catch (e) {
				instance.status = 'unresponsive';
				this.#logEvent(instance.port, 'error', `Instance failed to stop: ${messageOf(e)}`);
				return;
			}
		}
		const index = this.instances.indexOf(instance);
		if (index !== -1) this.instances.splice(index, 1);
		if (handle) this.#logEvent(instance.port, 'info', 'Instance stopped');
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
			this.#failedDeployments = 0;
			this.#logEvent(port, 'info', 'Instance running');
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

	// Chunks arrive at whatever size the stream hands over, so a partial line is carried
	// until the rest of it turns up. Errors when the process is killed, which is not news
	#capture(source: LogSource, output: ReadableStream<string>) {
		let carry = '';
		void output
			.pipeTo(
				new WritableStream({
					write: (chunk) => {
						const lines = (carry + chunk).split('\n');
						carry = lines.pop() ?? '';
						for (const line of lines) this.#logOutput(source, line.replace(/\r$/, ''));
					},
					close: () => {
						if (carry) this.#logOutput(source, carry);
					}
				})
			)
			.catch(() => {});
	}

	#logOutput(source: LogSource, text: string) {
		this.output.push({ kind: 'output', time: Date.now(), source, text });
		if (this.output.length > MAX_OUTPUT_LINES) this.output.shift();
	}

	#logEvent(source: LogSource, level: ResourceEvent['level'], text: string) {
		this.events.push({ kind: 'event', time: Date.now(), source, level, text });
		if (this.events.length > MAX_EVENTS) this.events.shift();
	}
}
