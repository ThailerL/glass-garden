import type { Node } from '@xyflow/svelte';
import { nodeConfig } from '$lib/graph-state.svelte';
import { getResourceDefinition, type ResourceType } from '.';

// The reason each field is refused, keyed by field name; absent means acceptable
export type NameIssues = Record<string, string | undefined>;

// The resource's own schema is the authority on shape; the canvas is the authority on what
// is already taken
export function buildNameValidator(type: ResourceType, nodes: Node[]) {
	const { name, namedOnCreate, configSchema } = getResourceDefinition(type);

	return (values: Record<string, string>): NameIssues => {
		const parsed = configSchema.safeParse(values);
		const issues: NameIssues = parsed.success
			? {}
			: Object.fromEntries(
					parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])
				);
		for (const { field, unique } of namedOnCreate?.fields ?? []) {
			if (!unique || issues[field]) continue;
			const taken = nodes.some(
				(existing) => existing.type === type && nodeConfig(existing)[field] === values[field]
			);
			if (taken) issues[field] = `A ${name} on this canvas already uses that.`;
		}
		return issues;
	};
}
