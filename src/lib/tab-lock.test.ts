import { describe, it, expect, vi, beforeEach } from 'vitest';

type Grant = (lock: object | null) => unknown;

// A holder keeps the lock until its callback's promise settles; `ifAvailable` never waits
function makeLockManager() {
	let held = false;
	const waiting: (() => void)[] = [];

	function grant(callback: Grant) {
		held = true;
		void Promise.resolve(callback({})).then(() => {
			held = false;
			waiting.shift()?.();
		});
	}

	return {
		// Both call shapes the real manager takes: with `{ ifAvailable: true }`, and with the
		// callback alone, which waits its turn
		request(_name: string, options: LockOptions | Grant, maybeCallback?: Grant) {
			const callback = maybeCallback ?? (options as Grant);
			if (!held) grant(callback);
			else if (maybeCallback) void callback(null);
			else waiting.push(() => grant(callback));
			return Promise.resolve();
		},
		// Another tab holding the lock, and closing
		hold() {
			let release!: () => void;
			grant(() => new Promise<void>((resolve) => (release = resolve)));
			return release;
		}
	};
}

let locks: ReturnType<typeof makeLockManager> | undefined;

async function loadModule() {
	vi.resetModules();
	vi.stubGlobal('navigator', { locks });
	return import('$lib/tab-lock');
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

beforeEach(() => {
	locks = makeLockManager();
});

describe('claimTabLock', () => {
	it('grants the lock to the only tab asking for it', async () => {
		const { claimTabLock } = await loadModule();
		await expect(claimTabLock()).resolves.toBe(true);
	});

	it('refuses a tab opened while another holds the lock', async () => {
		locks!.hold();
		const { claimTabLock } = await loadModule();
		await expect(claimTabLock()).resolves.toBe(false);
	});

	it('keeps holding the lock after the claim resolves', async () => {
		const { claimTabLock } = await loadModule();
		expect(await claimTabLock()).toBe(true);
		await settle();

		let free = false;
		locks!.request('glass-garden', { ifAvailable: true }, (lock) => void (free = lock !== null));
		expect(free).toBe(false);
	});

	it('asks once however many times it is called', async () => {
		const { claimTabLock } = await loadModule();
		const request = vi.spyOn(locks!, 'request');
		expect(await Promise.all([claimTabLock(), claimTabLock()])).toEqual([true, true]);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('runs the app where the browser has no lock manager', async () => {
		locks = undefined;
		const { claimTabLock } = await loadModule();
		await expect(claimTabLock()).resolves.toBe(true);
	});
});

describe('onTabLockFree', () => {
	it('waits for the holding tab to go away', async () => {
		const release = locks!.hold();
		const { claimTabLock, onTabLockFree } = await loadModule();
		expect(await claimTabLock()).toBe(false);

		const taken = vi.fn();
		onTabLockFree(taken);
		await settle();
		expect(taken).not.toHaveBeenCalled();

		release();
		await settle();
		expect(taken).toHaveBeenCalled();
	});
});
