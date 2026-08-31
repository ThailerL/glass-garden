export function keysWithPrefix(prefix: string): string[] {
	return Object.keys(localStorage).filter((key) => key.startsWith(prefix));
}

export function readEntry<T>(key: string): T | undefined {
	try {
		return JSON.parse(localStorage[key]) as T;
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
