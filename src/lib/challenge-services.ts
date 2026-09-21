import { nodeAuthored, nodeConfig, type GraphState } from './graph-state.svelte';
import type { Orchestrator } from './orchestrator.svelte';
import type { RunServices } from './challenge-run.svelte';
import { goalIds, type Challenge } from './challenge';
import { getResourceDefinition } from './resources';
import { recordRun } from './projects.svelte';
import { tellHost } from './embed';

// A script's events are the same operations as the node's own buttons and Save config
export function runServices(
	projectId: string,
	challenge: Challenge,
	graph: GraphState,
	orchestrator: Orchestrator
): RunServices {
	const allGoals = goalIds(challenge);
	return {
		canvas: () => ({
			nodes: graph.nodes.map((node) => ({
				id: node.id,
				type: node.type ?? '',
				config: nodeConfig(node),
				authored: nodeAuthored(node)
			})),
			edges: graph.edges.map(({ source, target }) => ({ source, target }))
		}),
		statuses: () =>
			Object.fromEntries(graph.nodes.map((node) => [node.id, orchestrator.getStatus(node.id)])),
		metrics: (nodeId) => orchestrator.getMetrics(nodeId),
		startAll: () => orchestrator.startAll(),
		start: (nodeId) => orchestrator.start(nodeId),
		stop: (nodeId) => orchestrator.stop(nodeId),
		setConfig: (nodeId, patch) => {
			const node = graph.getNode(nodeId);
			if (!node) return;
			const config = nodeConfig(node);
			const parsed = getResourceDefinition(node.type).configSchema.safeParse({
				...config,
				...patch
			});
			// A script's typo leaves the node as it was rather than resetting its settings
			if (!parsed.success) return;
			graph.updateNodeConfig(nodeId, parsed.data);
			orchestrator.refresh(nodeId);
		},
		stopAll: () => orchestrator.stopAll(),
		finished: ({ met, failed }) => {
			tellHost({ event: 'run', scored: true, met, failed });
			if (recordRun(projectId, met)) tellHost({ event: 'best', met, all: allGoals });
		},
		failedToStart: (nodeName) =>
			tellHost({ event: 'run', scored: false, reason: 'did-not-start', nodeName })
	};
}
