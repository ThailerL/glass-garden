import { adminDirectory, ensureAdminDirectory, nodeDirectory } from '$lib/container';
import type { Orchestrator } from '$lib/orchestrator.svelte';
import type { ShellLaunchOptions, ShellOwner } from '$lib/shell-sessions.svelte';

// Built here rather than in the session store because the orchestrator is a context
export function shellLaunchOptions(
	owner: ShellOwner,
	orchestrator: Orchestrator
): ShellLaunchOptions {
	const port = orchestrator.holdPort();
	const base = { PORT: String(port), TERM: 'xterm-256color' };
	const admin = owner.kind === 'admin';
	return {
		cwd: admin ? adminDirectory() : nodeDirectory(owner.nodeId),
		// Spread last, so a PORT the user set wins, as it does for instances
		env: admin ? base : { ...base, ...orchestrator.envFor(owner.nodeId) },
		port,
		prepare: admin ? ensureAdminDirectory : () => orchestrator.mountFiles(owner.nodeId),
		release: () => orchestrator.releasePort(port),
		// Only the port, which nothing else announces; the address is printed on server-ready
		banner: `\x1b[2mPORT=${port} is reserved for this shell\x1b[0m`
	};
}
