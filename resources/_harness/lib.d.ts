import type { IncomingMessage } from 'node:http';

export const EVENT_PREFIX: string;
export function putMetric(
  name: string,
  value: number | number[],
  unit: string,
  dimensions?: Record<string, string>,
  fold?: boolean
): void;
export function reportEvent(kind: string, fields: Record<string, unknown>): void;
export function bodyOf(req: IncomingMessage): Promise<Buffer>;
