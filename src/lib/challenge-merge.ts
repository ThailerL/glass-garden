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
		// A name the author never shipped is one the reader gave it, which moves nothing
		if (had.get(nodeName(node))?.type === node.type) changed = true;
	}

	for (const [name, node] of shipped) {
		const existing = authored.get(name);
		if (existing) {
			const written = writeNode(prefix, challenge, name, existing, node, needed.has(name));
			const was = had.get(name);
			if (written.some((entry) => authorChanged(before, name, was, entry))) changed = true;
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

// Each authored node's fixed settings that differ from what ships, as the shipped values
export function driftedSettings(
	challenge: ChallengeDocument,
	nodes: Node[]
): Map<string, Record<string, unknown>> {
	const shipped = startingNodes(challenge);
	const drifted = new Map<string, Record<string, unknown>>();
	for (const node of nodes.filter(nodeAuthored)) {
		const name = nodeName(node);
		const ships = shipped.get(name);
		if (!ships || ships.type !== node.type) continue;
		const drift = fixedDrift(challenge, name, nodeConfig(node), ships);
		if (drift.length) drifted.set(node.id, Object.fromEntries(drift));
	}
	return drifted;
}

// A fixed setting is the author's: the challenge renders it as a value, so whatever the reader
// holds is whatever they were given, and the new value can simply take its place. Whether the
// node may be deleted follows the new version too, but only the settings written are returned
function writeNode(
	prefix: string,
	challenge: ChallengeDocument,
	name: string,
	existing: Node,
	shipped: CanvasDocumentNode,
	needed: boolean
): [string, unknown][] {
	const config = nodeConfig(existing);
	const updates = fixedDrift(challenge, name, config, shipped);
	if (!updates.length && existing.deletable === !needed) return [];
	writeNodeAt(prefix, {
		...existing,
		deletable: !needed,
		data: { ...existing.data, config: { ...config, ...Object.fromEntries(updates) } }
	});
	return updates;
}

// The fixed settings a node holds at anything other than what this version ships
function fixedDrift(
	challenge: ChallengeDocument,
	name: string,
	config: Record<string, unknown>,
	shipped: CanvasDocumentNode
): [string, unknown][] {
	const fixes = fixesSetting(challenge, { name, authored: true });
	return Object.entries(shipped.config).filter(
		([key, value]) => fixes(key) && JSON.stringify(config[key]) !== JSON.stringify(value)
	);
}

// A value the author did not change is one a script's event left behind
function authorChanged(
	before: ChallengeDocument,
	name: string,
	was: CanvasDocumentNode | undefined,
	[key, value]: [string, unknown]
): boolean {
	const fixedBefore = fixesSetting(before, { name, authored: true });
	return !fixedBefore(key) || JSON.stringify(was?.config[key]) !== JSON.stringify(value);
}
