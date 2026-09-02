import {
	dimensionKey,
	looksLikeEmf,
	newSeries,
	parseEmfLine,
	record,
	type MetricDatum,
	type MetricSeries
} from './metrics';

const MAX_EVENTS = 50;
const MAX_OUTPUT_LINES = 500;
const MAX_METRIC_NAMES = 20;
// A request id in a dimension mints a series per request; real CloudWatch bills for the same
const MAX_SERIES_PER_NAME = 20;

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

// By metric name, then by dimension set: what separates two series is what the publisher
// declared, not which process printed the line
export type MetricStore = Partial<Record<string, Record<string, MetricSeries>>>;

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
	#warnedSeriesCap = false;

	capture(source: LogSource, output: ReadableStream<string>) {
		captureLines(output, (line) => this.#routeLine(source, line));
	}

	event(source: LogSource, level: ResourceEvent['level'], text: string) {
		this.events.push({ kind: 'event', time: Date.now(), source, level, text });
		if (this.events.length > MAX_EVENTS) this.events.shift();
	}

	// A captured line is either an Embedded Metric Format line or something the process
	// printed. Metric lines stay out of the log: one JSON blob per request would bury it
	#routeLine(source: LogSource, line: string) {
		if (!looksLikeEmf(line)) {
			this.#logOutput(source, line);
			return;
		}
		const parsed = parseEmfLine(line);
		if (!parsed.ok) {
			this.#logOutput(source, line);
			this.event(source, 'warning', `Ignored a metric line - it is ${parsed.reason}`);
			return;
		}
		for (const datum of parsed.data) this.putMetric(source, datum);
	}

	// Public because the region reports a resource's own measurements over its event
	// channel rather than through captured output. The source only names where a complaint
	// goes: a metric belongs to the node, and its dimensions say the rest
	putMetric(source: LogSource, { name, value, unit, dimensions }: MetricDatum) {
		const now = Date.now();
		if (this.metrics[name] === undefined) {
			// A name per request id is one typo away, so names are refused past the cap
			if (Object.keys(this.metrics).length >= MAX_METRIC_NAMES) {
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
			this.metrics[name] = {};
		}
		// Read back rather than reuse: $state hands out a proxy of what we assigned
		const byDimensions = this.metrics[name]!;
		const key = dimensionKey(dimensions);
		if (byDimensions[key] === undefined) {
			if (Object.keys(byDimensions).length >= MAX_SERIES_PER_NAME) {
				if (!this.#warnedSeriesCap) {
					this.#warnedSeriesCap = true;
					this.event(
						source,
						'warning',
						`"${name}" is reported under more than ${MAX_SERIES_PER_NAME} dimension combinations, so later ones are ignored`
					);
				}
				return;
			}
			byDimensions[key] = newSeries(now, unit, dimensions);
		}
		record(byDimensions[key], now, value);
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
