import type { Edge, Node } from '@xyflow/svelte';
import { nodeConfig, nodeName } from '$lib/graph-state.svelte';
import { getResourceDefinition } from '$lib/resources';
import type { Principal, Service, Topology } from '$lib/aws-region';

// One table maps every AWS node type to the service it serves and where its name lives in
// config. The name the emulator enforces on is not always the value a consumer's code wants
// - a queue is enforced by name but addressed by URL - so the environment side lives on each
// resource definition instead
const AWS_SERVICES: Partial<Record<string, { service: Service; resourceKey: string }>> = {
	s3Bucket: { service: 's3', resourceKey: 'bucketName' },
	sqsQueue: { service: 'sqs', resourceKey: 'queueName' },
	dynamodbTable: { service: 'dynamodb', resourceKey: 'tableName' }
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

const emptyResources = (): Record<Service, string[]> => ({ s3: [], sqs: [], dynamodb: [] });

// The whole enforcement input, rebuilt from the graph: which AWS services exist on the
// canvas at all, which node serves each resource, and for each caller, the resource names
// its edges grant it. Only consumers become principals - a resource node runs no code and
// is never issued credentials
export function buildTopology(nodes: readonly Node[], edges: readonly Edge[]): Topology {
	const awsNodes = new Map<string, AwsResource>();
	for (const node of nodes) {
		const resource = awsResourceOf(node);
		if (resource) awsNodes.set(node.id, resource);
	}

	const principals: Record<string, Principal> = {};
	const principalFor = (node: Node) => {
		const key = accessKeyFor(node.id);
		principals[key] ??= { nodeId: node.id, name: nodeName(node), resources: emptyResources() };
		return principals[key];
	};

	// Every node that can call AWS becomes a principal, granted nothing or not: without one,
	// an unconnected call is refused as an unknown key instead of being told to draw an edge
	for (const node of nodes) {
		if (getResourceDefinition(node.type).consumes.includes('aws')) principalFor(node);
	}

	// An edge at either end grants: code pointing at a resource uses it, and a resource
	// pointing at code triggers it, which the code then reads from with its own credentials
	for (const node of nodes) {
		const granted = edges.flatMap((edge) => {
			if (edge.source === node.id) return awsNodes.get(edge.target) ?? [];
			if (edge.target === node.id) return awsNodes.get(edge.source) ?? [];
			return [];
		});
		if (granted.length === 0) continue;
		const principal = principalFor(node);
		for (const { service, resourceName } of granted) {
			if (!principal.resources[service].includes(resourceName)) {
				principal.resources[service].push(resourceName);
			}
		}
	}

	// Sorted so an unchanged canvas always produces an identical document
	for (const principal of Object.values(principals)) {
		for (const names of Object.values(principal.resources)) names.sort();
	}
	const owners: Record<Service, Record<string, string>> = { s3: {}, sqs: {}, dynamodb: {} };
	for (const [nodeId, resource] of awsNodes) {
		owners[resource.service][resource.resourceName] = nodeId;
	}
	const services = [...new Set([...awsNodes.values()].map((entry) => entry.service))].sort();
	return { services, principals, owners };
}
