import { describe, expect, it } from 'vitest';
import { resourceDefinitions, type ResourceDefinition } from './index';

const definitions: [string, ResourceDefinition][] = Object.entries(resourceDefinitions);

describe('resourceDefinitions', () => {
	// An edge records no capability: each end reads it under every capability it recognises.
	// So two types sharing more than one would make one edge mean two things at once
	it('lets every edge mean one thing', () => {
		for (const [sourceType, source] of definitions) {
			for (const [targetType, target] of definitions) {
				const shared = source.consumes.filter((capability) => target.provides.includes(capability));
				expect(
					shared.length,
					`An edge ${sourceType} → ${targetType} could mean ${shared.join(' and ')}. Give handles ids, one per capability, before adding this pair`
				).toBeLessThanOrEqual(1);
			}
		}
	});
});
