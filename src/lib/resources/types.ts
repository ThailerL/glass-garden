import { z } from 'zod';
import type { Component } from 'svelte';
import { Vivari, type FileSystemTree } from '@vivari/core';
import { Position, type Node } from '@xyflow/svelte';
import type { LucideIcon } from '@lucide/svelte';

// Where xyflow connection handles sit on the node
export type NodeHandleConfig = { type: 'source' | 'target'; position: Position };

// Returned by a definition's start so the orchestrator can manage an instance's
// lifecycle without touching whatever the definition actually launched
export type InstanceHandle = {
	// Resolves when the underlying process exits, however it exits
	exited: Promise<void>;
	stop: () => Promise<void>;
};

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
};

// Read-only snapshot of the graph around a node, rebuilt per call so a resource
// always reads current topology without reaching into the orchestrator
export type UpstreamContext = {
	// Each outgoing edge's target with its current instances
	upstreams: { nodeId: string; instances: Instance[] }[];
};

export type ResourceDefinition = {
	name: string;
	icon: LucideIcon;
	// Mounted for every resource. hasEditableFiles only decides whether the editor exposes them
	files: FileSystemTree;
	hasEditableFiles: boolean;
	handles: NodeHandleConfig[];
	configComponent: Component<{ form: unknown }>;
	configSchema: z.ZodObject<z.ZodRawShape>;
	instanceCount: (node: Node) => number;
	// For resources that don't host a server: start() resolving is being fully up, so
	// instances go straight to 'running' instead of waiting for a server-ready that
	// never comes
	readyOnStart?: boolean;
	// The subset of config whose change requires relaunching instances. Omitted when
	// nothing does; name-only changes never bounce anything
	launchConfig?: (node: Node) => unknown;
	prepare?: (node: Node, container: Vivari) => Promise<void>;
	start: (
		node: Node,
		container: Vivari,
		port: number,
		context: UpstreamContext
	) => Promise<InstanceHandle>;
	// Called when something this resource points at changes, so it can rewrite whatever
	// config its running process reads
	update?: (node: Node, container: Vivari, context: UpstreamContext) => Promise<void>;
};
