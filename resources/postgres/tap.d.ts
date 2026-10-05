import type { EventEmitter } from 'node:events';

export function connectionTap(onQuery: () => void): (chunk: Buffer) => void;
export function tapAlongside(socket: EventEmitter, tap: (chunk: Buffer) => void): void;
export const RESET_MARKER: string;
