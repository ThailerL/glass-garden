import { describe, expect, it, vi } from 'vitest';
import { ResourceLog } from '$lib/resource-log.svelte';

async function feed(log: ResourceLog, lines: string[]) {
	log.capture(
		3001,
		new ReadableStream({ start: (c) => (c.enqueue(lines.join('\n') + '\n'), c.close()) })
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ResourceLog routing', () => {
	it('hands traffic lines to the canvas and keeps them out of the log', async () => {
		const onTraffic = vi.fn();
		const log = new ResourceLog(onTraffic);
		await feed(log, ['hello', 'gg:event {"kind":"hop","at":1,"to":{"port":3002}}']);
		expect(onTraffic).toHaveBeenCalledWith({ kind: 'hop', at: 1, to: { port: 3002 } });
		expect(log.output.map((line) => line.text)).toEqual(['hello']);
	});

	it('logs a traffic line it cannot read, and says why once', async () => {
		const onTraffic = vi.fn();
		const log = new ResourceLog(onTraffic);
		await feed(log, ['gg:event {"kind":"hop"}']);
		expect(onTraffic).not.toHaveBeenCalled();
		expect(log.output.map((line) => line.text)).toEqual(['gg:event {"kind":"hop"}']);
		expect(log.events.map((event) => event.text)).toEqual([
			'Ignored a traffic line. It is a hop without a time'
		]);
	});

	it("files an environment's lines under its own stream and reads metrics in them", () => {
		const log = new ResourceLog(vi.fn());
		log.environmentLine('e1', 'START RequestId: r1 Version: $LATEST');
		log.environmentLine(
			'e1',
			'{"_aws":{"Timestamp":1,"CloudWatchMetrics":[{"Namespace":"n","Dimensions":[[]],"Metrics":[{"Name":"requests","Unit":"Count"}]}]},"requests":1}'
		);
		expect(log.streams).toEqual([{ source: 'env:e1', label: 'e1', alive: true }]);
		expect(log.output.map((line) => [line.source, line.text])).toEqual([
			['env:e1', 'START RequestId: r1 Version: $LATEST']
		]);
		expect(Object.keys(log.metrics)).toEqual(['requests']);
		log.environmentExit('e1');
		expect(log.streams[0].alive).toBe(false);
	});
});
