import { getBezierPath, Position } from '@xyflow/system';

// The lanes end on the target's instance dots, which sit at this pitch on the card
export const LANE_PITCH = 12;
export const FAN_LENGTH = 40;
// More dots than fit the card: the edge stays single and lands at the handle
export const MAX_LANES = 7;

export const fans = (instances: number) => instances > 1 && instances <= MAX_LANES;

// One lane end per instance, centred on the handle
export function laneOffsets(instances: number): number[] {
	if (!fans(instances)) return [];
	return Array.from({ length: instances }, (_, i) => (i - (instances - 1) / 2) * LANE_PITCH);
}

export function lanePath(splitX: number, splitY: number, endX: number, endY: number): string {
	return getBezierPath({
		sourceX: splitX,
		sourceY: splitY,
		sourcePosition: Position.Right,
		targetX: endX,
		targetY: endY,
		targetPosition: Position.Left
	})[0];
}
