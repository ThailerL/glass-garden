import type { Node } from '@xyflow/svelte';
import type { Capability, ResourceDefinition, ConnectedNode } from './types';
import { instanceGroup } from './instance-group';
import { httpLoadBalancer } from './http-load-balancer';
import { postgres } from './postgres';
import { s3Bucket } from './s3-bucket';
import { sqsQueue } from './sqs-queue';
import { dynamodbTable } from './dynamodb-table';

export * from './types';

export const resourceDefinitions = {
	instanceGroup,
	httpLoadBalancer,
	postgres,
	s3Bucket,
	sqsQueue,
	dynamodbTable
} satisfies Record<string, ResourceDefinition>;

export type ResourceType = keyof typeof resourceDefinitions;

export function getResourceDefinition(type: string | undefined): ResourceDefinition {
	const definition = resourceDefinitions[type as ResourceType];
	if (!definition) {
		throw new Error(`Unknown resource type: ${type}`);
	}
	return definition;
}

export function canConnect(source: Node, target: Node): boolean {
	if (source.id === target.id) return false;
	const { consumes } = getResourceDefinition(source.type);
	const { provides } = getResourceDefinition(target.type);
	return consumes.some((capability) => provides.includes(capability));
}

// The connections a definition should actually read, so an edge that means nothing to it is
// skipped rather than misread
export function providing(
	connected: readonly ConnectedNode[],
	capability: Capability
): readonly ConnectedNode[] {
	return connected.filter(({ node }) =>
		getResourceDefinition(node.type).provides.includes(capability)
	);
}
