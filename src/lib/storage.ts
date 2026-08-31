// Snapshotted rather than iterated lazily, so a caller can delete the keys it is handed
export function keysWithPrefix(prefix: string): string[] {
	const keys: string[] = [];
	for (let index = 0; index < localStorage.length; index++) {
		const key = localStorage.key(index);
		if (key?.startsWith(prefix)) keys.push(key);
	}
	return keys;
}

export function readEntry<T>(key: string): T | undefined {
	// Checked rather than left to the parse, which would read a missing key as a stored null
	const raw = localStorage.getItem(key);
	if (raw === null) return undefined;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
}

export function readByPrefix<T>(prefix: string): T[] {
	return keysWithPrefix(prefix).flatMap((key) => {
		const entry = readEntry<T>(key);
		return entry === undefined ? [] : [entry];
	});
}
