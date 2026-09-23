import type { CanvasDocument, CanvasDocumentNode } from '../../src/lib/project-document';

// Authored positions only say what is beside what, so each distinct x becomes a column and each
// distinct y a row, whatever spacing the author happened to leave
export const NODE_SIZE = 104;
const GAP = { x: 56, y: 32 };

export type PlacedNode = { node: CanvasDocumentNode; left: number; top: number };

function track(values: number[]): Map<number, number> {
	return new Map([...new Set(values)].sort((a, b) => a - b).map((value, index) => [value, index]));
}

export function layoutCanvas({ nodes, edges }: CanvasDocument) {
	const columns = track(nodes.map((node) => node.position.x));
	const rows = track(nodes.map((node) => node.position.y));

	const placed = nodes.map((node) => ({
		node,
		left: columns.get(node.position.x)! * (NODE_SIZE + GAP.x),
		top: rows.get(node.position.y)! * (NODE_SIZE + GAP.y)
	}));
	const at = new Map(placed.map(({ node, left, top }) => [node.id, { left, top }]));

	// Handle to handle: out of the right of one node, into the left of the next
	const wires = edges
		.map(({ source, target }) => {
			const from = at.get(source);
			const to = at.get(target);
			if (!from || !to) return undefined;
			return {
				x1: from.left + NODE_SIZE,
				y1: from.top + NODE_SIZE / 2,
				x2: to.left,
				y2: to.top + NODE_SIZE / 2
			};
		})
		.filter((wire) => wire !== undefined);

	return {
		placed,
		wires,
		width: columns.size * NODE_SIZE + (columns.size - 1) * GAP.x,
		height: rows.size * NODE_SIZE + (rows.size - 1) * GAP.y
	};
}
