// The VM's file system, the service worker routing previews to it and the graph in localStorage
// are all per-origin, so a second tab would run a second VM over the first one's files
const LOCK_NAME = 'glass-garden';

let claim: Promise<boolean> | undefined;

// A lock is held until its callback's promise settles, and this one never does
const forever = () => new Promise<never>(() => {});

export function claimTabLock(): Promise<boolean> {
	// No lock manager outside a secure context, where the VM cannot run either
	claim ??= navigator.locks
		? new Promise<boolean>((resolve) => {
				void navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
					resolve(lock !== null);
					return lock ? forever() : undefined;
				});
			})
		: Promise.resolve(true);
	return claim;
}

// Keeps the lock once it is granted, so the caller can reload into it
export function onTabLockFree(taken: () => void) {
	void navigator.locks?.request(LOCK_NAME, () => {
		taken();
		return forever();
	});
}
