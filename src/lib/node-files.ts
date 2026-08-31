import type { Node } from '@xyflow/svelte';
import type { FileSystemTree } from '@vivari/core';
import * as resourceFiles from 'virtual:resource-files';
import { getResourceDefinition } from './resources';
import type { NodeData } from './graph-state.svelte';

export type FileSetId = keyof typeof resourceFiles.templates;

// A node created from a template can start on one of that template's file sets rather than
// its resource type's own, so two nodes of the same type can run different code
export function nodeFiles(node: Node): FileSystemTree {
	const id = (node.data as NodeData).files;
	return id ? resourceFiles.templates[id] : getResourceDefinition(node.type).files;
}
