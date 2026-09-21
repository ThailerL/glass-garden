import type { Node } from '@xyflow/svelte';
import { fixesSetting, neededNodes } from './challenge';
import { storeNodeFiles } from './files/imported-files';
import {
	buildNode,
	graphKeyPrefix,
	nodeAuthored,
	nodeConfig,
	nodeName,
	readNodesAt,
	writeNodeAt
} from './graph-state.svelte';
import { startingNodes, type CanvasDocumentNode, type ChallengeDocument } from './project-document';

// Brings a reader's canvas to a version of the challenge it was laid down from, and says whether
// anything moved. Only what the challenge owns is written: the nodes it ships and the settings it
// fixes. Their own nodes, the settings left to them, their wiring and the code in their editor
// are left exactly as they are. `before` is the version the canvas was last brought to, which is
// what tells a node the reader deleted from one the author has added since.
//
// Written straight to storage rather than through a GraphState: this runs for a project that is
// not open, and the open one is brought up to date before its canvas is built.
export function mergeStartingCanvas(
	projectId: string,
	before: ChallengeDocument,
	challenge: ChallengeDocument
): boolean {
	const prefix = graphKeyPrefix(projectId);
	const shipped = startingNodes(challenge);
	const had = startingNodes(before);
	const needed = neededNodes(challenge);
	const authored = new Map<string, Node>();
	let changed = false;

	for (const node of readNodesAt(prefix).filter(nodeAuthored)) {
		if (shipped.get(nodeName(node))?.type === node.type) {
			authored.set(nodeName(node), node);
			continue;
		}
		// Dropped or retyped by the author, so it becomes the reader's own: nothing can name it now
		writeNodeAt(prefix, { ...node, deletable: true, data: { ...node.data, authored: undefined } });
		changed = true;
	}

	for (const [name, node] of shipped) {
		const existing = authored.get(name);
		if (existing) {
			if (writeNode(prefix, challenge, name, existing, node, needed.has(name))) changed = true;
			continue;
		}
		// Shipped before and gone now is one the reader deleted, and it stays deleted unless named
		if (had.get(name)?.type === node.type && !needed.has(name)) continue;
		const added = buildNode(node.type, node.position, {
			config: node.config,
			chart: node.chart,
			testEvent: node.testEvent,
			authored: true,
			deletable: !needed.has(name)
		});
		storeNodeFiles(added.id, node.type, challenge.startingCanvas.nodeFiles[node.id]);
		writeNodeAt(prefix, added);
		changed = true;
	}

	return changed;
}

// A fixed setting is the author's: the challenge renders it as a value, so whatever the reader
// holds is whatever they were given, and the new value can simply take its place. Whether the
// node may be deleted follows the new version too, but only a setting counts as the canvas moving
function writeNode(
	prefix: string,
	challenge: ChallengeDocument,
	name: string,
	existing: Node,
	shipped: CanvasDocumentNode,
	needed: boolean
): boolean {
	const fixes = fixesSetting(challenge, { name, authored: true });
	const config = nodeConfig(existing);
	const updates = Object.entries(shipped.config).filter(
		([key, value]) => fixes(key) && JSON.stringify(config[key]) !== JSON.stringify(value)
	);
	if (!updates.length && existing.deletable === !needed) return false;
	writeNodeAt(prefix, {
		...existing,
		deletable: !needed,
		data: { ...existing.data, config: { ...config, ...Object.fromEntries(updates) } }
	});
	return updates.length > 0;
}
