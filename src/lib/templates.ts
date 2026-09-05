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
		name: 'Load balancer health checks',
		description:
			'Break one instance on purpose and watch the load balancer stop sending it traffic.',
		icon: LoadBalancerIcon,
		build: (graph) => {
			// Charted on the canvas so an instance leaving the pool is seen from there. Aggregate
			// requests would not show it: the balancer serves the same total from fewer targets
			const balancer = graph.addNode(
				'httpLoadBalancer',
				{ x: -100, y: 0 },
				{ chart: 'healthy hosts' }
			);
			const app = graph.addNode(
				'instanceGroup',
				{ x: 100, y: 0 },
				{ files: 'load-balanced-app/instance-group', config: { name: 'Web App' } }
			);
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
	queueApp: {
		name: 'Async work behind a queue',
		description:
			"Signups arrive faster than passwords can be hashed. Raise the worker's concurrency and watch the backlog drain.",
		icon: resourceDefinitions.sqsQueue.icon,
		build: (graph) => {
			const generator = graph.addNode(
				'requestGenerator',
				{ x: -300, y: 0 },
				{
					chart: 'response time',
					config: {
						name: 'Signup Traffic',
						method: 'POST',
						path: '/signup',
						body: JSON.stringify({ email: 'someone@example.com', password: 'hunter2' }),
						// Above what one execution environment can hash
						requestsPerSecond: 5
					}
				}
			);
			const app = graph.addNode(
				'instanceGroup',
				{ x: -100, y: 0 },
				{
					files: 'queue-app/instance-group',
					// One instance, since the lesson is behind the queue rather than in front of it
					config: { name: 'Signup API', instanceCount: 1 },
					chart: 'signups'
				}
			);
			const queue = graph.addNode(
				'sqsQueue',
				{ x: 100, y: 0 },
				{ config: { name: 'Signups', queueName: 'signups' }, chart: 'messages' }
			);
			const worker = graph.addNode(
				'lambdaFunction',
				{ x: 300, y: 0 },
				{
					files: 'queue-app/lambda-function',
					// One at a time to start with, so the backlog is the first thing seen
					config: { name: 'Hash Password', timeout: 30, maxConcurrency: 1 },
					chart: 'concurrent executions'
				}
			);
			graph.addEdge(generator.id, app.id);
			graph.addEdge(app.id, queue.id);
			graph.addEdge(queue.id, worker.id);
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
