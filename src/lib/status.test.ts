import { describe, it, expect } from 'vitest';
import type { Instance, InstanceStatus } from '$lib/resources';
import { uptimeText } from '$lib/status';

describe('uptimeText', () => {
	const started = 1_700_000_000_000;
	const up = (status: InstanceStatus): Instance => ({
		port: 3000,
		status,
		configStamp: '',
		deployment: 0,
		replacement: false,
		startedAt: started
	});
	const after = (ms: number) => uptimeText(up('running'), started + ms);

	it.each([
		[0, '0s'],
		[59_000, '59s'],
		[60_000, '1m'],
		[3_599_000, '59m'],
		[3_600_000, '1h']
	])('reads %ims as %s', (elapsed, text) => {
		expect(after(elapsed)).toBe(text);
	});

	// The clock and the stamp are read at different moments, so they can cross
	it('never counts backwards', () => {
		expect(after(-5000)).toBe('0s');
	});

	// The slot outlives the process, so its stamp would otherwise keep climbing while down
	it('has no answer for a crashed instance', () => {
		expect(uptimeText(up('crashed'), started + 60_000)).toBeUndefined();
	});

	// A stopped instance is dropped from its pool, so its row has no instance to read
	it('has no answer where there is no instance', () => {
		expect(uptimeText(undefined, started + 60_000)).toBeUndefined();
	});

	// Still the same process, so the time it has been up is still true
	it('keeps counting while an instance is stopping or unresponsive', () => {
		expect(uptimeText(up('stopping'), started + 60_000)).toBe('1m');
		expect(uptimeText(up('unresponsive'), started + 60_000)).toBe('1m');
	});
});
