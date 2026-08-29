import { z } from 'zod';
import { Position, type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import DatabaseIcon from '@lucide/svelte/icons/database';
import * as resourceFiles from 'virtual:resource-files';
import PostgresConfig from './PostgresConfig.svelte';
import { connectionUrl } from './connection';
import type { NodeHandleConfig, ResourceDefinition, Upstream } from '../types';
import { npmInstall, processHandle } from '../shared';
import { nodeDirectory, requestPersistentStorage } from '$lib/container';
import { nodeConfig } from '$lib/graph-state.svelte';

const configSchema = z.object({
	name: z.string().min(1).default('Postgres'),
	maxConnections: z.number().int().positive().default(100)
});

type Config = z.infer<typeof configSchema>;

function launchConfig(node: Node) {
	return { maxConnections: nodeConfig<Config>(node).maxConnections };
}

type LaunchConfig = ReturnType<typeof launchConfig>;

export const postgres = {
	name: 'Postgres',
	icon: DatabaseIcon,
	files: resourceFiles.postgres,
	hasEditableFiles: false,
	hasPreview: false,
	handles: [{ type: 'target', position: Position.Left }] satisfies NodeHandleConfig[],
	configComponent: PostgresConfig,
	configSchema,
	// PGlite is single-writer, so a second instance would be a second database
	instanceCount: () => 1,
	connectionUrl: (_node: Node, port: number) => connectionUrl(port),
	launchConfig,
	prepare: async (node: Node, container: Vivari) => {
		// Not awaited: on Firefox this prompts, and the install shouldn't wait on an answer
		void requestPersistentStorage();
		await npmInstall(node, container);
	},
	start: async (
		node: Node,
		container: Vivari,
		port: number,
		_upstreams: readonly Upstream[],
		config: unknown
	) => {
		const { maxConnections } = config as LaunchConfig;
		const process = await container.spawn('node', ['server.js'], {
			cwd: nodeDirectory(node.id),
			env: { PORT: String(port), MAX_CONNECTIONS: String(maxConnections) }
		});
		return processHandle(process);
	}
} satisfies ResourceDefinition;
