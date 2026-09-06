export function callerUser(nodeId: string): string;
export function nodeInStartup(payload: Buffer): string | undefined;
export function connectionTap(onQuery: (node: string) => void): (chunk: Buffer) => void;
