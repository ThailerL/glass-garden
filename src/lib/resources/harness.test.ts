import { describe, expect, it } from 'vitest';
import { resourceDefinitions } from './index';
import { treeFiles } from '$lib/project-document';

describe('withHarness', () => {
	it.each(Object.entries(resourceDefinitions))(
		'lays _harness into %s exactly when its code imports it, and never into a tree the reader edits',
		(_type, { files, hasEditableFiles }) => {
			const imports = Object.values(treeFiles(files)).some((contents) =>
				contents.includes('./_harness/')
			);
			expect('_harness' in files).toBe(imports && !hasEditableFiles);
		}
	);
});
