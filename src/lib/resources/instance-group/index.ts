import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import ServerIcon from '@lucide/svelte/icons/server';
import * as resourceFiles from 'virtual:resource-files';
import InstanceGroupConfig from './InstanceGroupConfig.svelte';
import type { ResourceDefinition, Upstream } from '../types';
import { getResourceDefinition, upstreamsProviding } from '../index';
import { npmInstall, processHandle } from '../shared';
import { nodeDirectory } from '$lib/container';
import { nodeConfig, nodeName } from '$lib/graph-state.svelte';

const configSchema = z.object({
	name: z.string().min(1).default('Instance Group'),
	instanceCount: z.number().int().positive().default(3),
	command: z.string().min(1).default('npm run start')
});

export type Config = z.infer<typeof configSchema>;

// "Bob's Orders DB" -> BOBS_ORDERS_DB_URL. Apostrophes and accents are folded away
// rather than becoming separators
function variableName(node: Node) {
	const slug = nodeName(node)
		.normalize('NFD')
		.replace(/['\u2019]/g, '')
		.replace(/\p{Diacritic}/gu, '')
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return `${slug || 'RESOURCE'}_URL`;
}

// A variable per upstream that advertises a connection URL, named after it so an app
// wired to several datastores gets meaningful names. Sorted so the set - and with it the
// configStamp - never depends on edge insertion order
function connectionEnv(upstreams: readonly Upstream[]): Record<string, string> {
	const connections = upstreamsProviding(upstreams, 'sql')
		.flatMap(({ node, reservedPorts }) => {
			const { connectionUrl } = getResourceDefinition(node.type);
			// Not a live instance's port, so the stamp survives the upstream restarting
			const [port] = reservedPorts;
			return connectionUrl && port !== undefined ? [{ node, url: connectionUrl(node, port) }] : [];
		})
		.sort(
			(a, b) =>
				nodeName(a.node).localeCompare(nodeName(b.node)) || a.node.id.localeCompare(b.node.id)
		);

	const env: Record<string, string> = {};
	for (const { node, url } of connections) {
		const base = variableName(node);
		let name = base;
		for (let suffix = 2; name in env; suffix++) name = `${base}_${suffix}`;
		env[name] = url;
	}
	// The single-database case gets the conventional name too
	if (connections.length === 1) env.DATABASE_URL ??= connections[0].url;
	return env;
}

function launchConfig(node: Node, upstreams: readonly Upstream[]) {
	return {
		command: nodeConfig<Config>(node).command,
		env: connectionEnv(upstreams)
	};
}

type LaunchConfig = ReturnType<typeof launchConfig>;

export const instanceGroup = {
	name: 'Instance Group',
	icon: ServerIcon,
	files: resourceFiles.instanceGroup,
	hasEditableFiles: true,
	hasPreview: true,
	ownsStoredData: false,
	provides: ['http'],
	consumes: ['sql'],
	configComponent: InstanceGroupConfig,
	configSchema,
	// The names the examples report. A user's own metric falls back to the default
	metricDefaults: { requests: 'sum', 'response ms': 'avg' },
	instanceCount: (node: Node) => nodeConfig<Config>(node).instanceCount,
	launchConfig,
	prepare: npmInstall,
	start: async (
		node: Node,
		container: Vivari,
		port: number,
		_upstreams: readonly Upstream[],
		config: unknown
	) => {
		const { command, env } = config as LaunchConfig;
		// Split command by whitespace
		const commandParts = command.match(/\S+/g);
		if (!commandParts) {
			throw new Error('Command is empty');
		}
		const process = await container.spawn(commandParts[0], commandParts.slice(1), {
			cwd: nodeDirectory(node.id),
			env: { PORT: String(port), ...env }
		});
		return processHandle(process);
	}
} satisfies ResourceDefinition;
