import type { Edge, Node } from '@xyflow/svelte';
import { nodeConfig, nodeName } from '$lib/graph-state.svelte';
import { regionEndpointUrl } from '$lib/aws-region';
import { envSlug } from '$lib/resources/shared';
import type { Principal, Service, Topology } from '$lib/aws-region';

// One table describes every AWS node type: which service it is, where its name lives in
// config, and how that name reaches a consumer's environment. Adding a resource family
// means adding a row, not touching the topology builder or the instance group
const AWS_SERVICES: Partial<
	Record<string, { service: Service; resourceKey: string; envSuffix: string; soleEnvName: string }>
> = {
	s3Bucket: {
		service: 's3',
		resourceKey: 'bucketName',
		envSuffix: 'BUCKET',
		soleEnvName: 'S3_BUCKET'
	}
};

export type AwsResource = {
	service: Service;
	resourceName: string;
	envSuffix: string;
	soleEnvName: string;
};

// What a node serves, or undefined when it is not an AWS resource at all
export function awsResourceOf(node: Node): AwsResource | undefined {
	const entry = AWS_SERVICES[node.type ?? ''];
	if (!entry) return undefined;
	const resourceName = nodeConfig<Record<string, unknown>>(node)[entry.resourceKey];
	if (typeof resourceName !== 'string' || !resourceName) return undefined;
	return { ...entry, resourceName };
}

// The access key a node's code signs with. The bridge maps it back to this node, so a
// denial can name the caller and be routed to its log
export function accessKeyFor(nodeId: string) {
	return `gg${nodeId.replace(/[^A-Za-z0-9]/g, '')}`;
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

	// Any edge to an AWS node grants: an edge only exists if the capability check allowed
	// it, so re-testing `consumes` here would only couple this to the resource registry
	for (const node of nodes) {
		const granted = edges
			.filter((edge) => edge.source === node.id)
			.flatMap((edge) => awsNodes.get(edge.target) ?? []);
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

// The AWS SDK's own variables, so user code constructs a client with no Glass Garden
// vocabulary in it. The secret is a fixed string: the region enforces on the access key's
// credential scope and never checks a signature
export function awsEnv(consumer: Node, targets: readonly Node[]): Record<string, string> {
	const resources = targets
		.flatMap((node) => {
			const resource = awsResourceOf(node);
			return resource ? [{ node, ...resource }] : [];
		})
		.sort(
			(a, b) => a.resourceName.localeCompare(b.resourceName) || a.node.id.localeCompare(b.node.id)
		);
	if (resources.length === 0) return {};

	const env: Record<string, string> = {
		AWS_ENDPOINT_URL: regionEndpointUrl,
		AWS_REGION: 'us-east-1',
		AWS_ACCESS_KEY_ID: accessKeyFor(consumer.id),
		AWS_SECRET_ACCESS_KEY: 'glass-garden'
	};
	for (const resource of resources) {
		const base = `${envSlug(resource.node)}_${resource.envSuffix}`;
		let variable = base;
		for (let suffix = 2; variable in env; suffix++) variable = `${base}_${suffix}`;
		env[variable] = resource.resourceName;
	}
	// The single-resource-of-its-kind case gets the conventional name too
	const perService = new Map<Service, number>();
	for (const { service } of resources) perService.set(service, (perService.get(service) ?? 0) + 1);
	for (const resource of resources) {
		if (perService.get(resource.service) === 1) env[resource.soleEnvName] = resource.resourceName;
	}
	return env;
}
