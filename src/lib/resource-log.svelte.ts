import {
	METRIC_SENTINEL,
	newSeries,
	parseMetricLine,
	record,
	type MetricDatum,
	type MetricSeries
} from './metrics';

const MAX_EVENTS = 50;
const MAX_OUTPUT_LINES = 500;
const MAX_METRIC_NAMES = 20;

// What produced an entry: an instance, named by its port, or 'resource' for the node's own work
export type LogSource = number | 'resource';

// Shared fields that let output and events sort into one stream and filter by one source
type LogEntry = {
	time: number;
	source: LogSource;
	text: string;
};

// A line a process printed
export type OutputLine = LogEntry & { kind: 'output' };

// Something the orchestrator did, which carries a severity printed output cannot
export type ResourceEvent = LogEntry & { kind: 'event'; level: 'info' | 'warning' | 'error' };

// What one source has reported, by metric name
export type SourceMetrics = Partial<Record<string, MetricSeries>>;

// A source appears only once it has reported something
export type MetricStore = Partial<Record<LogSource, SourceMetrics>>;

// Everything one node has said: what its processes printed, what the reconciler did to it and
// what it reported as metrics. Write-only from the reconciler's side, which never reads these
// back to decide anything - so the caps here can drop the oldest without consequence
export class ResourceLog {
	// Both oldest first
	events = $state<ResourceEvent[]>([]);
	output = $state<OutputLine[]>([]);
	metrics = $state<MetricStore>({});

	// So a flood of new names does not fill the log with the complaint about it
	#warnedNameCap = false;

	capture(source: LogSource, output: ReadableStream<string>) {
		captureLines(output, (line) => this.#routeLine(source, line));
	}

	event(source: LogSource, level: ResourceEvent['level'], text: string) {
		this.events.push({ kind: 'event', time: Date.now(), source, level, text });
		if (this.events.length > MAX_EVENTS) this.events.shift();
	}

	// A captured line is either a metric report or something the process printed
	#routeLine(source: LogSource, line: string) {
		if (!line.startsWith(METRIC_SENTINEL)) {
			this.#logOutput(source, line);
			return;
		}
		const parsed = parseMetricLine(line);
		if (!parsed.ok) {
			this.#logOutput(source, line);
			this.event(source, 'warning', `Ignored a metric line - it is ${parsed.reason}`);
			return;
		}
		this.putMetric(source, parsed.report);
	}

	// Public because the region reports a resource's own measurements over its event
	// channel rather than through captured output
	putMetric(source: LogSource, { name, value }: MetricDatum) {
		const now = Date.now();
		this.metrics[source] ??= {};
		// Read back rather than reuse: $state hands out a proxy of what we assigned
		const bySource = this.metrics[source];
		if (bySource[name] === undefined) {
			// A name per request id is one typo away, so names are refused past the cap
			if (Object.keys(bySource).length >= MAX_METRIC_NAMES) {
				if (!this.#warnedNameCap) {
					this.#warnedNameCap = true;
					this.event(
						source,
						'warning',
						`Reporting more than ${MAX_METRIC_NAMES} different metrics, so later ones are ignored`
					);
				}
				return;
			}
			bySource[name] = newSeries(now);
		}
		record(bySource[name], now, value);
	}

	#logOutput(source: LogSource, text: string) {
		this.output.push({ kind: 'output', time: Date.now(), source, text });
		if (this.output.length > MAX_OUTPUT_LINES) this.output.shift();
	}
}

// Chunks arrive at whatever size the stream hands over, so a partial line is carried
// until the rest of it turns up. Errors when the process is killed, which is not news
export function captureLines(output: ReadableStream<string>, onLine: (line: string) => void) {
	let carry = '';
	void output
		.pipeTo(
			new WritableStream({
				write: (chunk) => {
					const lines = (carry + chunk).split('\n');
					carry = lines.pop() ?? '';
					for (const line of lines) onLine(line.replace(/\r$/, ''));
				},
				close: () => {
					if (carry) onLine(carry);
				}
			})
		)
		.catch(() => {});
}
