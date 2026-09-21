import { readEntry } from '../storage';
import { getResourceDefinition } from '../resources';
import type { NodeFiles } from '../project-document';

// An imported node's own code, held from the import until the page load that mounts it
const keyFor = (nodeId: string) => `importedFiles:${nodeId}`;

export function storeImportedFiles(nodeId: string, files: NodeFiles) {
	localStorage.setItem(keyFor(nodeId), JSON.stringify(files));
}

// A document is anyone's text: it can name a node that is not there, or one whose files the
// region provisions and the reader never writes
export function storeNodeFiles(nodeId: string, type: string, files: NodeFiles | undefined) {
	if (files && getResourceDefinition(type).hasEditableFiles) storeImportedFiles(nodeId, files);
}

export function readImportedFiles(nodeId: string): NodeFiles | undefined {
	return readEntry<NodeFiles>(keyFor(nodeId));
}

export function forgetImportedFiles(nodeId: string) {
	localStorage.removeItem(keyFor(nodeId));
}
