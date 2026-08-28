import type { ResourceDefinition } from './types';
import { instanceGroup } from './instance-group';
import { loadBalancer } from './load-balancer';

export * from './types';

export const resourceDefinitions = {
	instanceGroup,
	loadBalancer
} satisfies Record<string, ResourceDefinition>;

export type ResourceType = keyof typeof resourceDefinitions;

export function getResourceDefinition(type: string | undefined): ResourceDefinition {
	const definition = resourceDefinitions[type as ResourceType];
	if (!definition) {
		throw new Error(`Unknown resource type: ${type}`);
	}
	return definition;
}
