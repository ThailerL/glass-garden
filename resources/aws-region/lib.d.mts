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
	services: string[];
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
// Two things the bridge reports over one stdout channel: sentences for a node's log, and
// measurements for its metric store
export type RegionEvent =
	| { kind: 'log'; level: 'info' | 'error'; message: string; nodeId?: string }
	| { kind: 'metric'; nodeId: string; name: string; value: number };

export const EVENT_PREFIX: string;
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
