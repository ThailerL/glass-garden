export type Service = 's3' | 'sqs' | 'dynamodb' | 'lambda';
export type Credential = { accessKeyId: string; region: string; service: string };
// nodeId is absent for the admin, who is not a node: denials then have no log to go to
export type Principal = {
	nodeId?: string;
	name: string;
	resources: Record<Service, string[]>;
};
// owners maps a resource name back to the node serving it, so the bridge can attribute
// what it observes about a resource to the node the user sees; ports, where the region
// serves each function's URL
export type Topology = {
	principals: Record<string, Principal>;
	owners: Record<Service, Record<string, string>>;
	ports: Record<string, number>;
};
export type Denial = {
	allow: false;
	status: number;
	code: string;
	message: string;
	nodeId?: string;
};
export type Decision = { allow: true } | Denial;
// What the bridge reports about a node over its stdout channel: sentences for its log,
// measurements for its metric store, and what a function's execution environments print,
// filed under that environment's own stream. Traffic for the canvas rides the same channel
// in the vocabulary every hidden process shares (src/lib/traffic.svelte.ts)
export type NodeReport =
	| { kind: 'log'; level: 'info' | 'error'; message: string; nodeId?: string }
	| {
			kind: 'metric';
			nodeId: string;
			name: string;
			value: number;
			unit?: string;
			dimensions?: Record<string, string>;
	  }
	| { kind: 'output'; nodeId: string; environment: string; line: string }
	| { kind: 'environment-exit'; nodeId: string; environment: string };

export const EVENT_PREFIX: string;
export function receivedMessages(responseText: string): { Body?: string }[];
export function escapeXml(text: string): string;
export function emptyByService<T>(make: () => T): Record<Service, T>;
export function emptyTopology(): Topology;
export function parseCredential(authorization: string | undefined): Credential | undefined;
export function bucketFromPath(path: string): string | undefined;
export function invokedFunctionName(path: string): string | undefined;
export function extractResourceNames(
	service: string | undefined,
	path: string,
	bodyText: string | undefined,
	headers?: Record<string, string | string[] | undefined>
): string[];
export function decideRequest(
	request: { credential: Credential | undefined; resourceNames: string[] },
	topology: Topology
): Decision;
export function denialResponse(
	service: string | undefined,
	denial: Denial
): { status: number; contentType: string; body: string };
