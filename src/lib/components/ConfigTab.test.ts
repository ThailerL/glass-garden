import { describe, expect, it, vi } from 'vitest';
import { configsMatch } from './ConfigTab.svelte';

// The tab's instance script reaches the project store, which reads storage as it loads; the
// function under test needs none of it
vi.mock('$lib/projects.svelte', () => ({}));

describe('configsMatch', () => {
	it('ignores the order the form built its keys in', () => {
		expect(configsMatch({ name: 'app', port: 3000 }, { port: 3000, name: 'app' })).toBe(true);
		expect(configsMatch({ name: 'app', port: 3000 }, { name: 'app', port: 3001 })).toBe(false);
	});

	it('reads a nested setting rather than the object around it', () => {
		expect(configsMatch({ limits: { rate: 5 } }, { limits: { rate: 5 } })).toBe(true);
		expect(configsMatch({ limits: { rate: 5 } }, { limits: { rate: 6 } })).toBe(false);
	});

	it('keeps the order of a list, which is a setting in itself', () => {
		expect(configsMatch({ routes: ['/a', '/b'] }, { routes: ['/b', '/a'] })).toBe(false);
	});

	it('treats a field left undefined as one the config never had, unlike an emptied one', () => {
		expect(configsMatch({ name: 'app', chart: undefined }, { name: 'app' })).toBe(true);
		expect(configsMatch({ name: 'app', chart: null }, { name: 'app' })).toBe(false);
	});
});
