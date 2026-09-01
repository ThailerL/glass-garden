import type { ResourceStatus } from './resources';

export const STATUS_TEXT: Record<ResourceStatus, string> = {
	starting: 'Starting',
	running: 'Running',
	stopping: 'Stopping',
	stopped: 'Stopped',
	degraded: 'Degraded',
	crashed: 'Crashed',
	unresponsive: 'Unresponsive'
};

export const STATUS_DOT_CLASS: Record<ResourceStatus, string> = {
	starting: 'bg-blue-500 animate-pulse',
	running: 'bg-green-500',
	stopping: 'bg-blue-500 animate-pulse',
	stopped: 'bg-muted-foreground',
	degraded: 'bg-amber-500',
	crashed: 'bg-red-500',
	unresponsive: 'bg-violet-500'
};
