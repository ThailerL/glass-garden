import type { Node } from '@xyflow/svelte';
import type { ConnectedNode } from './types';
import { getResourceDefinition } from './index';
import { envSlug } from './shared';
import { nodeName } from '$lib/graph-state.svelte';
import { accessKeyFor } from '$lib/aws-topology';
import { regionEndpointUrl } from '$lib/aws-region';

// The AWS SDK's own variables. Every node that can call AWS gets them, connected to something
// or not: code reaches CloudWatch regardless, and an unconnected call should be refused by the
// topology with a signpost rather than by having no credentials at all. The secret is a fixed
// string - the region enforces on the access key's credential scope and never checks a signature
function awsCredentials(consumer: Node): Record<string, string> {
	return {
		AWS_ENDPOINT_URL: regionEndpointUrl,
		AWS_REGION: 'us-east-1',
		AWS_ACCESS_KEY_ID: accessKeyFor(consumer.id),
		AWS_SECRET_ACCESS_KEY: 'glass-garden'
	};
}

// Everything the nodes connected to this one hand it, in either direction. Sorted so the
// set - and with it the configStamp - never depends on edge order
function suppliedBy(neighbours: readonly ConnectedNode[]) {
	return neighbours
		.flatMap(({ node, reservedPorts }) => {
			const { supplies } = getResourceDefinition(node.type);
			// The reservation rather than a live port, so the stamp survives a restart there
			const [port] = reservedPorts;
			return supplies && port !== undefined ? [{ node, ...supplies(node, port) }] : [];
		})
		.sort(
			(a, b) =>
				nodeName(a.node).localeCompare(nodeName(b.node)) || a.node.id.localeCompare(b.node.id)
		);
}

// The conventional names that are deliberately not set, because more than one resource of
// that kind is connected and the name would have to pick one of them arbitrarily. Reported so
// a panel can say why a variable a user expected is missing, rather than leaving it silent
export function withheldConventionalNames(neighbours: readonly ConnectedNode[]): string[] {
	const perSoleName = new Map<string, number>();
	for (const { soleName } of suppliedBy(neighbours)) {
		perSoleName.set(soleName, (perSoleName.get(soleName) ?? 0) + 1);
	}
	return [...perSoleName]
		.filter(([, count]) => count > 1)
		.map(([soleName]) => soleName)
		.sort();
}

// Everything a consumer's code is launched with because of what it is connected to. Each
// provider says what it supplies; the naming lives here, because collisions and the
// conventional single-resource name are decisions about the whole set rather than any one
// of them
export function consumerEnv(
	consumer: Node,
	neighbours: readonly ConnectedNode[]
): Record<string, string> {
	const supplied = suppliedBy(neighbours);

	// Credentials come with being able to call AWS at all, not with any particular resource:
	// code can reach CloudWatch with nothing connected, and gets a signpost error otherwise.
	// The namespace is read only by the metrics library, which warns on every line without one
	const env: Record<string, string> = getResourceDefinition(consumer.type).consumes.includes('aws')
		? { ...awsCredentials(consumer), POWERTOOLS_METRICS_NAMESPACE: 'glass-garden' }
		: {};

	for (const { node, suffix, value } of supplied) {
		const base = `${envSlug(node)}_${suffix}`;
		let name = base;
		for (let n = 2; name in env; n++) name = `${base}_${n}`;
		env[name] = value;
	}

	const perSoleName = new Map<string, number>();
	for (const { soleName } of supplied) {
		perSoleName.set(soleName, (perSoleName.get(soleName) ?? 0) + 1);
	}
	for (const { soleName, value } of supplied) {
		if (perSoleName.get(soleName) === 1) env[soleName] ??= value;
	}
	return env;
}
