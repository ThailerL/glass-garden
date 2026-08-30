import type { Node } from '@xyflow/svelte';
import type { Capability, ResourceDefinition, Upstream } from './types';
import { instanceGroup } from './instance-group';
import { loadBalancer } from './load-balancer';
import { postgres } from './postgres';

export * from './types';

export const resourceDefinitions = {
	instanceGroup,
	loadBalancer,
	postgres
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

// The upstreams a definition should actually read, so an edge that means nothing to it is
// skipped rather than misread
export function upstreamsProviding(
	upstreams: readonly Upstream[],
	capability: Capability
): readonly Upstream[] {
	return upstreams.filter(({ node }) =>
		getResourceDefinition(node.type).provides.includes(capability)
	);
}
