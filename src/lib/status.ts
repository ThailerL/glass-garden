import type { Instance, ResourceStatus } from './resources';

export const STATUS_TEXT: Record<ResourceStatus, string> = {
	starting: 'Starting',
	running: 'Running',
	stopping: 'Stopping',
	stopped: 'Stopped',
	degraded: 'Degraded',
	crashed: 'Crashed',
	unresponsive: 'Unresponsive'
};

// undefined once there is no process to have been up
export function uptimeText(instance: Instance | undefined, now: number): string | undefined {
	if (!instance || instance.status === 'crashed') return undefined;
	const seconds = Math.max(0, Math.floor((now - instance.startedAt) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	return `${Math.floor(seconds / 3600)}h`;
}

export const STATUS_DOT_CLASS: Record<ResourceStatus, string> = {
	starting: 'bg-blue-500 animate-pulse',
	running: 'bg-green-500',
	stopping: 'bg-blue-500 animate-pulse',
	stopped: 'bg-muted-foreground',
	degraded: 'bg-amber-500',
	crashed: 'bg-red-500',
	unresponsive: 'bg-violet-500'
};
