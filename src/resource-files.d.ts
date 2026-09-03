// Hand-written types for the module the resource-files plugin in vite.config.ts builds.
// Adding a directory under resources/ means adding it here too.
declare module 'virtual:resource-files' {
	import type { FileSystemTree } from '@vivari/core';
	export const instanceGroup: FileSystemTree;
	export const lambdaFunction: FileSystemTree;
	export const functionManager: FileSystemTree;
	export const httpLoadBalancer: FileSystemTree;
	export const awsRegion: FileSystemTree;
	export const postgres: FileSystemTree;
	// One entry per directory under a template, keyed by the path to it
	export const templates: Record<
		'postgres-app/instance-group' | 's3-app/instance-group',
		FileSystemTree
	>;
}
