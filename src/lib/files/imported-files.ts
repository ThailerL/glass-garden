import { readEntry } from '../storage';
import type { NodeFiles } from '../project-document';

// An imported node's own code, held from the import until the page load that mounts it
const keyFor = (nodeId: string) => `importedFiles:${nodeId}`;

export function storeImportedFiles(nodeId: string, files: NodeFiles) {
	localStorage.setItem(keyFor(nodeId), JSON.stringify(files));
}

export function readImportedFiles(nodeId: string): NodeFiles | undefined {
	return readEntry<NodeFiles>(keyFor(nodeId));
}

export function forgetImportedFiles(nodeId: string) {
	localStorage.removeItem(keyFor(nodeId));
}
