import type { Node } from '@xyflow/svelte';
import type { FileSystemTree } from '@vivari/core';
import * as resourceFiles from 'virtual:resource-files';
import { getResourceDefinition } from '../resources';
import type { NodeData } from '../graph-state.svelte';
import { fileTree } from './file-tree';

export type FileSetId = keyof typeof resourceFiles.templates;

// A node created from a template can start on one of that template's file sets rather than
// its resource type's own, so two nodes of the same type can run different code
export function nodeFiles(node: Node): FileSystemTree {
	const { code, files } = node.data as NodeData;
	if (code) return fileTree(code);
	return files ? resourceFiles.templates[files] : getResourceDefinition(node.type).files;
}
