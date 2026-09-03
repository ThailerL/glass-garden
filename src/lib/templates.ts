import type { LucideIcon } from '@lucide/svelte';
import LoadBalancerIcon from './resources/http-load-balancer/LoadBalancerIcon.svelte';
import SquareDashedIcon from '@lucide/svelte/icons/square-dashed';
import { resourceDefinitions } from './resources';
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
		description: 'Spread real requests across three Node servers you can edit and watch respond.',
		icon: LoadBalancerIcon,
		build: (graph) => {
			const balancer = graph.addNode('httpLoadBalancer', { x: -100, y: 0 });
			const app = graph.addNode('instanceGroup', { x: 100, y: 0 }, { config: { name: 'Web App' } });
			graph.addEdge(balancer.id, app.id);
		}
	},
	postgresApp: {
		name: 'App with a Postgres database',
		description:
			'Count page views in a real Postgres server shared by three load-balanced instances.',
		icon: resourceDefinitions.postgres.icon,
		build: (graph) => {
			const balancer = graph.addNode('httpLoadBalancer', { x: -200, y: 0 });
			const app = graph.addNode(
				'instanceGroup',
				{ x: 0, y: 0 },
				{ files: 'postgres-app/instance-group', config: { name: 'View Counter' } }
			);
			const db = graph.addNode('postgres', { x: 200, y: 0 });
			graph.addEdge(balancer.id, app.id);
			graph.addEdge(app.id, db.id);
		}
	},
	s3App: {
		name: 'App with an S3 bucket',
		description: 'Write notes into a bucket using the real AWS SDK.',
		icon: resourceDefinitions.s3Bucket.icon,
		build: (graph) => {
			// One instance, so the notes' metrics stay on one line
			const app = graph.addNode(
				'instanceGroup',
				{ x: 0, y: 0 },
				{ files: 's3-app/instance-group', config: { name: 'Notes App', instanceCount: 1 } }
			);
			const bucket = graph.addNode(
				's3Bucket',
				{ x: 200, y: 0 },
				{ config: { name: 'Notes', bucketName: 'notes' } }
			);
			graph.addEdge(app.id, bucket.id);
		}
	},
	blank: {
		name: 'Blank canvas',
		description: 'Start from nothing and drag in resources yourself.',
		icon: SquareDashedIcon,
		build: () => {}
	}
} satisfies Record<string, Template>;

export type TemplateId = keyof typeof templates;
