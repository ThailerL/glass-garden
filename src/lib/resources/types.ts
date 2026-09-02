import { z } from 'zod';
import type { Component } from 'svelte';
import { Vivari, type FileSystemTree } from '@vivari/core';
import { type Node } from '@xyflow/svelte';
import type { LucideIcon } from '@lucide/svelte';
import type { ChartReading } from '$lib/metrics';

// What a resource offers its dependents and what it needs from them. An edge is legal when
// its source consumes something its target provides
export type Capability = 'http' | 'sql' | 'aws';

// Returned by a definition's start so the orchestrator can manage an instance's
// lifecycle without touching whatever the definition actually launched
export type InstanceHandle = {
	// Resolves with the exit code when the underlying process exits, however it exits.
	// A crash on startup often says nothing else, so the code is the whole diagnosis
	exited: Promise<number>;
	stop: () => Promise<void>;
	output?: ReadableStream<string>;
};

// Hands a stream of output to the node's log, for work that belongs to the node rather
// than to one of its instances
export type Capture = (output: ReadableStream<string>) => void;

// No 'stopped': a stopped instance is dropped from its pool
export type InstanceStatus =
	// From slot creation until fully up: spawning, then waiting for its server to listen
	| 'starting'
	// Fully up, in its dependents' rotation. Reached via server-ready, or straight
	// from start for definitions with readyOnStart
	| 'running'
	| 'stopping'
	| 'crashed'
	// Failed to stop/kill the instance/process
	| 'unresponsive';

// A resource aggregates its instances, so it has two states no single instance can be
// in: 'stopped' when it has none left, and 'degraded' when only some of them are up
export type ResourceStatus = InstanceStatus | 'stopped' | 'degraded';

// A port is reserved first, then the process starts and gives a preview URL
export type Instance = {
	port: number;
	status: InstanceStatus;
	handle?: InstanceHandle;
	previewUrl?: string;
	// JSON of the definition's launchConfig at spawn; a mismatch with current
	// config means the instance must be relaunched to pick up the change
	configStamp: string;
	// The deployment that spawned it, so a whole deployment failing counts once against
	// the restart budget however many instances it put up
	deployment: number;
	// Put up by a pass that was clearing crashed instances, so a start that follows a
	// failure reads differently from a first one
	replacement: boolean;
	// When the slot was created, re-stamped on a crash because the slot is made again. Says
	// which instance restarted, where the node's restart count only says that one did
	startedAt: number;
};

// The node at the other end of an edge, with its current instances - either direction, so
// a resource can ask what it consumes or what consumes it. The instances belong to another
// controller and are passed by reference, so they are read-only here
export type ConnectedNode = {
	readonly node: Node;
	readonly instances: readonly Readonly<Instance>[];
	readonly reservedPorts: readonly number[];
};

export type ResourceDefinition = {
	name: string;
	icon: LucideIcon;
	// Mounted for every resource. hasEditableFiles only decides whether the editor exposes them
	files: FileSystemTree;
	hasEditableFiles: boolean;
	hasPreview: boolean;
	// Whether the node's directory holds data the user would miss
	ownsStoredData: boolean;
	// Also what the node's handles are drawn from, one per direction rather than one per
	// capability: a non-empty provides earns the target handle, a non-empty consumes the source
	provides: Capability[];
	consumes: Capability[];
	configComponent: Component<{ form: never; nodeId: string }>;
	// Every resource is named, so anything holding a node can read config.name unguarded
	configSchema: z.ZodObject<{ name: z.ZodType<string> } & z.ZodRawShape>;
	metricDefaults?: Partial<Record<string, ChartReading>>;
	instanceCount: (node: Node) => number;
	// Whether an instance is a real process. A resource served by the AWS region still has one
	// slot, but nothing listens on its port, so a port and a per-instance breakdown name
	// nothing the user could act on
	runsProcesses: boolean;
	// For resources that don't host a server: start() resolving is being fully up, so
	// instances go straight to 'running' instead of waiting for a server-ready that
	// never comes
	readyOnStart?: boolean;
	// Everything an instance is launched with that requires relaunching it when it changes:
	// the node's own config, plus what upstreams hand down. Omitted when nothing does
	launchConfig?: (node: Node, upstreams: readonly ConnectedNode[]) => unknown;
	// How a dependent reaches one of this resource's instances, so nothing downstream has
	// to know which engine is behind the port
	connectionUrl?: (node: Node, port: number) => string;
	prepare?: (node: Node, container: Vivari, capture: Capture) => Promise<void>;
	start: (
		node: Node,
		container: Vivari,
		port: number,
		upstreams: readonly ConnectedNode[],
		// What launchConfig returned, so an instance is guaranteed to run the config it is stamped with
		launchConfig: unknown
	) => Promise<InstanceHandle>;
	// Called when something this resource points at changes, so it can rewrite whatever
	// config its running process reads
	update?: (node: Node, container: Vivari, upstreams: readonly ConnectedNode[]) => Promise<void>;
	// Called when the node is deleted. For data that lives outside the node's directory
	remove?: (node: Node, container: Vivari) => Promise<void>;
};
