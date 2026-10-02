import type { EventEmitter } from 'node:events';

export function callerUser(nodeId: string): string;
export function nodeInStartup(payload: Buffer): string | undefined;
export function connectionTap(onQuery: (node: string) => void): (chunk: Buffer) => void;
export function tapAlongside(socket: EventEmitter, tap: (chunk: Buffer) => void): void;
export const RESET_MARKER: string;
