import type { Edge, Node } from '@xyflow/svelte';
import { nodeConfig, nodeName, nodePorts } from '$lib/graph-state.svelte';
import { getResourceDefinition } from '$lib/resources';
import type { Principal, Service, Topology } from '$lib/aws-region';
import { emptyByService, notificationQueueName } from '../../resources/aws-region/lib.js';

// One table maps every AWS node type to the service it serves and where its name lives in
// config. The name the emulator enforces on is not always the value a consumer's code wants
// - a queue is enforced by name but addressed by URL - so the environment side lives on each
// resource definition instead
const AWS_SERVICES: Partial<Record<string, { service: Service; resourceKey: string }>> = {
	s3Bucket: { service: 's3', resourceKey: 'bucketName' },
	sqsQueue: { service: 'sqs', resourceKey: 'queueName' },
	dynamodbTable: { service: 'dynamodb', resourceKey: 'tableName' },
	// Served by its own manager rather than the emulator, but invoked through the region
	lambdaFunction: { service: 'lambda', resourceKey: 'functionName' }
};

export type AwsResource = { service: Service; resourceName: string };

// What a node serves, or undefined when it is not an AWS resource at all
export function awsResourceOf(node: Node): AwsResource | undefined {
	const entry = AWS_SERVICES[node.type ?? ''];
	if (!entry) return undefined;
	const resourceName = nodeConfig<Record<string, unknown>>(node)[entry.resourceKey];
	if (typeof resourceName !== 'string' || !resourceName) return undefined;
	return { ...entry, resourceName };
}

// The access key a node's code signs with. The bridge maps it back to this node, so a
// denial can name the caller and be routed to its log. Carried whole: node ids are nanoid
// (A-Za-z0-9_-), which the credential scope parses fine, and folding characters out would
// let two nodes share one key and so one node's grants
export function accessKeyFor(nodeId: string) {
	return `gg${nodeId}`;
}

// Cannot collide with a node's: ids are eight characters
export const ADMIN_ACCESS_KEY = accessKeyFor('admin');

export { notificationQueueName } from '../../resources/aws-region/lib.js';

// The whole enforcement input, rebuilt from the graph: which node serves each resource, and
// for each caller, the resource names its edges grant it. Only consumers become principals -
// a resource node runs no code and is never issued credentials
export function buildTopology(nodes: readonly Node[], edges: readonly Edge[]): Topology {
	const awsNodes = new Map<string, AwsResource>();
	// The reserved port of anything the region relays to
	const ports: Record<string, number> = {};
	for (const node of nodes) {
		const resource = awsResourceOf(node);
		if (!resource) continue;
		awsNodes.set(node.id, resource);
		const [port] = nodePorts(node);
		if (getResourceDefinition(node.type).runsProcesses && port !== undefined) {
			ports[node.id] = port;
		}
	}

	// Every node that can call AWS is a principal, granted or not, so an unconnected call is
	// told to draw an edge rather than refused as an unknown key. An edge at either end
	// grants: code pointing at a resource uses it, a resource pointing at code triggers it
	const principals: Record<string, Principal> = {};
	for (const node of nodes) {
		if (!getResourceDefinition(node.type).consumes.includes('aws')) continue;
		const principal: Principal = {
			nodeId: node.id,
			name: nodeName(node),
			resources: emptyByService<string[]>(() => [])
		};
		principals[accessKeyFor(node.id)] = principal;
		const granted = edges.flatMap((edge) => {
			if (edge.source === node.id) return awsNodes.get(edge.target) ?? [];
			if (edge.target === node.id) return awsNodes.get(edge.source) ?? [];
			return [];
		});
		// A bucket pointing at code delivers its events through the code's own notification
		// queue, which only that direction creates
		if (edges.some((e) => e.target === node.id && awsNodes.get(e.source)?.service === 's3')) {
			granted.push({ service: 'sqs', resourceName: notificationQueueName(node.id) });
		}
		for (const { service, resourceName } of granted) {
			if (!principal.resources[service].includes(resourceName)) {
				principal.resources[service].push(resourceName);
			}
		}
	}

	const owners = emptyByService<Record<string, string>>(() => ({}));
	for (const [nodeId, resource] of awsNodes) {
		owners[resource.service][resource.resourceName] = nodeId;
	}

	// The admin shell is not a node and draws no edges, so it holds every resource on the canvas
	principals[ADMIN_ACCESS_KEY] = {
		name: 'Admin',
		resources: Object.fromEntries(
			Object.entries(owners).map(([service, byName]) => [service, Object.keys(byName)])
		) as Record<Service, string[]>
	};

	// Sorted so an unchanged canvas always produces an identical document
	for (const principal of Object.values(principals)) {
		for (const names of Object.values(principal.resources)) names.sort();
	}
	return { principals, owners, ports };
}
