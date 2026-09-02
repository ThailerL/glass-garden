export type Service = 's3' | 'sqs' | 'dynamodb';
export type Credential = { accessKeyId: string; region: string; service: string };
export type Principal = {
	nodeId: string;
	name: string;
	resources: Record<Service, string[]>;
};
export type Topology = { services: string[]; principals: Record<string, Principal> };
export type Denial = {
	allow: false;
	status: number;
	code: string;
	message: string;
	nodeId?: string;
};
export type Decision = { allow: true } | Denial;
export type RegionEvent = { level: string; message: string; nodeId?: string };

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
