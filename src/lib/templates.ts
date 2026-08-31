import type { LucideIcon } from '@lucide/svelte';
import LoadBalancerIcon from './resources/http-load-balancer/LoadBalancerIcon.svelte';
import DatabaseIcon from '@lucide/svelte/icons/database';
import SquareDashedIcon from '@lucide/svelte/icons/square-dashed';
import type { GraphState } from './graph-state.svelte';

export type Template = {
	name: string;
	description: string;
	icon: LucideIcon;
	build: (graph: GraphState) => void;
};

export const templates = {
	loadBalancedApp: {
		name: 'Load-balanced app',
		description: 'A load balancer spreading requests across three copies of one app.',
		icon: LoadBalancerIcon,
		build: (graph) => {
			const balancer = graph.addNode('httpLoadBalancer', { x: -100, y: 0 });
			const app = graph.addNode('instanceGroup', { x: 100, y: 0 });
			graph.addEdge(balancer.id, app.id);
		}
	},
	postgresApp: {
		name: 'Load-balanced app with a database',
		description: 'Three instances sharing one page-view count in Postgres.',
		icon: DatabaseIcon,
		build: (graph) => {
			const balancer = graph.addNode('httpLoadBalancer', { x: -200, y: 0 });
			const app = graph.addNode('instanceGroup', { x: 0, y: 0 }, 'postgres-app/instance-group');
			const db = graph.addNode('postgres', { x: 200, y: 0 });
			graph.addEdge(balancer.id, app.id);
			graph.addEdge(app.id, db.id);
		}
	},
	blank: {
		name: 'Blank',
		description: 'An empty canvas to build on.',
		icon: SquareDashedIcon,
		build: () => {}
	}
} satisfies Record<string, Template>;

export type TemplateId = keyof typeof templates;
