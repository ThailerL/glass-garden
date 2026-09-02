import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import DatabaseIcon from '@lucide/svelte/icons/database';
import * as resourceFiles from 'virtual:resource-files';
import PostgresConfig from './PostgresConfig.svelte';
import { connectionUrl } from './connection';
import type { Capture, ResourceDefinition, ConnectedNode } from '../types';
import { npmInstall, processHandle } from '../shared';
import { nodeDirectory } from '$lib/container';
import { nodeConfig } from '$lib/graph-state.svelte';

const configSchema = z.object({
	name: z.string().min(1).default('Postgres'),
	maxConnections: z.number().int().positive().default(100)
});

export type Config = z.infer<typeof configSchema>;

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
	ownsStoredData: true,
	provides: ['sql'],
	consumes: [],
	configComponent: PostgresConfig,
	configSchema,
	metricDefaults: { connections: 'avg', 'database size (MB)': 'avg' },
	// PGlite is single-writer, so a second instance would be a second database
	instanceCount: () => 1,
	runsProcesses: true,
	connectionUrl: (_node: Node, port: number) => connectionUrl(port),
	launchConfig,
	prepare: async (node: Node, container: Vivari, capture: Capture) => {
		await npmInstall(node, container, capture);
	},
	start: async (
		node: Node,
		container: Vivari,
		port: number,
		_upstreams: readonly ConnectedNode[],
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
