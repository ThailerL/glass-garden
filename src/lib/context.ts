import { getContext, setContext } from 'svelte';

export function createContext<T>(name: string) {
	const key = Symbol(name);
	return {
		set: (value: T) => setContext(key, value),
		get: () => getContext<T>(key)
	};
}
