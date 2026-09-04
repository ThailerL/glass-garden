import { z } from 'zod';
import { type Node } from '@xyflow/svelte';
import { Vivari } from '@vivari/core';
import GaugeIcon from '@lucide/svelte/icons/gauge';
import * as resourceFiles from 'virtual:resource-files';
import RequestGeneratorConfig from './RequestGeneratorConfig.svelte';
import type { ConnectedNode, ResourceDefinition } from '../types';
import { providing } from '../index';
import { processHandle } from '../shared';
import { nodeDirectory } from '$lib/container';
import { nodeConfig } from '$lib/graph-state.svelte';

const configSchema = z.object({
	name: z.string().min(1).default('Request Generator'),
	method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
	path: z.string().startsWith('/', 'Must start with /').default('/'),
	body: z.string().default(''),
	// A guard rail rather than a limit: measured headroom is far above this, so the cap is only
	// here to keep a typo from wedging a slower machine than the one it was measured on
	requestsPerSecond: z.coerce.number().positive().max(2000).default(10),
	maxInFlight: z.coerce.number().int().min(1).max(1000).default(50)
});

export type Config = z.infer<typeof configSchema>;

// The first running instance of whatever the generator points at, or null while there is none.
// One rather than all: splitting traffic is a load balancer's job
export function targetPort(connected: readonly ConnectedNode[]): number | null {
	for (const { instances } of providing(connected, 'http')) {
		const running = instances.find((instance) => instance.status === 'running');
		if (running) return running.port;
	}
	return null;
}

// The knobs travel with the target rather than in launchConfig, so a rate change or a
// scale-up reaches the running process without restarting it and zeroing the run
async function writeConfig(node: Node, container: Vivari, targets: readonly ConnectedNode[]) {
	const { method, path, body, requestsPerSecond, maxInFlight } = nodeConfig<Config>(node);
	// An update can reach a generator whose start has not mounted it yet
	await container.fs.mkdir(nodeDirectory(node.id), { recursive: true });
	await container.fs.writeFile(
		`${nodeDirectory(node.id)}/config.json`,
		JSON.stringify({
			method,
			path,
			body,
			requestsPerSecond,
			maxInFlight,
			target: targetPort(targets)
		})
	);
}

export const requestGenerator = {
	name: 'Request Generator',
	icon: GaugeIcon,
	files: resourceFiles.requestGenerator,
	hasEditableFiles: false,
	hasPreview: false,
	ownsStoredData: false,
	provides: [],
	consumes: ['http'],
	singleTarget: true,
	configComponent: RequestGeneratorConfig,
	configSchema,
	instanceCount: () => 1,
	// A process, but one that serves no one, so its port names nothing
	runsProcesses: false,
	readyOnStart: true,
	instanceLabel: 'generator',
	start: async (
		node: Node,
		container: Vivari,
		_port: number,
		targets: readonly ConnectedNode[]
	) => {
		// Written before the process spawns so its first tick already has a target
		await writeConfig(node, container, targets);
		const process = await container.spawn('node', ['generator.js'], {
			cwd: nodeDirectory(node.id)
		});
		return processHandle(process);
	},
	update: writeConfig
} satisfies ResourceDefinition;
