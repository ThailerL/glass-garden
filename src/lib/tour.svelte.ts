import type { Node } from '@xyflow/svelte';
import type { GraphState } from './graph-state.svelte';

const ORDER = ['run', 'select', 'preview', 'refresh', 'app', 'metrics', 'done'] as const;

export type TourStep = (typeof ORDER)[number];

// Only the steps that ask the reader for something are counted
export const NUMBERED_STEPS: readonly TourStep[] = ORDER.slice(0, ORDER.indexOf('done'));

const SEEN_KEY = 'tourSeen';
const PROJECT_KEY = 'tourProjectId';

// Fixed shape: the tour's steps name what is on this canvas
export function buildTourCanvas(graph: GraphState) {
	const balancer = graph.addNode('httpLoadBalancer', { x: -100, y: 0 });
	const app = graph.addNode('instanceGroup', { x: 100, y: 0 }, { config: { name: 'Web App' } });
	graph.addEdge(balancer.id, app.id);
	localStorage.setItem(PROJECT_KEY, graph.projectId);
}

class TourState {
	step = $state<TourStep | undefined>();
	refreshed = $state(false);
	balancerId = $state<string | undefined>();
	// The canvas is built again on every return from the editor, and a tour already under way
	// carries on from where it stood rather than starting over
	#begun = false;

	begin(projectId: string, nodes: readonly Node[]) {
		if (this.#begun || localStorage.getItem(PROJECT_KEY) !== projectId) return;
		if (localStorage.getItem(SEEN_KEY)) return;

		const balancer = nodes.find((node) => node.type === 'httpLoadBalancer');
		if (!balancer) return;

		this.#begun = true;
		this.balancerId = balancer.id;
		this.step = 'run';
	}

	// Steps end when the app reaches the state they asked for, so the tour never narrates
	// something the user has not done. Naming the step it is leaving keeps a condition that
	// stays true after the move from advancing the tour twice
	completed(step: TourStep) {
		if (this.step !== step) return;
		this.step = ORDER[ORDER.indexOf(step) + 1];
	}

	noteRefresh(nodeId: string) {
		if (this.step === 'refresh' && nodeId === this.balancerId) this.refreshed = true;
	}

	end() {
		this.step = undefined;
		localStorage.setItem(SEEN_KEY, 'true');
	}
}

export const tour = new TourState();
