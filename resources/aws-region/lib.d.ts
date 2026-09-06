export type Service = 's3' | 'sqs' | 'dynamodb';
export type Credential = { accessKeyId: string; region: string; service: string };
export type Principal = {
	nodeId: string;
	name: string;
	resources: Record<Service, string[]>;
};
// owners maps a resource name back to the node serving it, so the bridge can attribute
// what it observes about a resource to the node the user sees
export type Topology = {
	principals: Record<string, Principal>;
	owners: Record<Service, Record<string, string>>;
};
export type Denial = {
	allow: false;
	status: number;
	code: string;
	message: string;
	nodeId?: string;
};
export type Decision = { allow: true } | Denial;
// What the bridge reports about a node over its stdout channel: sentences for its log and
// measurements for its metric store. Traffic for the canvas rides the same channel in the
// vocabulary every hidden process shares (src/lib/traffic.svelte.ts)
export type NodeReport =
	| { kind: 'log'; level: 'info' | 'error'; message: string; nodeId?: string }
	| { kind: 'metric'; nodeId: string; name: string; value: number; unit?: string };

export const EVENT_PREFIX: string;
export function receivedMessages(responseText: string): { Body?: string }[];
export function notificationQueueName(nodeId: string): string;
export function isNotificationQueue(name: string): boolean;
export function notifiedBuckets(messages: { Body?: string }[]): string[];
export function emptyTopology(): Topology;
export function parseCredential(authorization: string | undefined): Credential | undefined;
export function bucketFromPath(path: string): string | undefined;
export function extractResourceName(
	service: string | undefined,
	path: string,
	bodyText: string | undefined
): string | undefined;
export function decideRequest(
	request: { credential: Credential | undefined; resourceName: string | undefined },
	topology: Topology
): Decision;
export function denialResponse(
	service: string | undefined,
	denial: Denial
): { status: number; contentType: string; body: string };
