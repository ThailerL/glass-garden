// Drives HTTP traffic at the one thing it points at. Hidden from the user: what it sends, how
// fast and to where is config.json, which the canvas rewrites and this process re-reads
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

// The host stores one datapoint per second, so a second's observations travel as one line
const METRIC_PERIOD_MS = 1000;
// Overridable so tests need not wait a second per re-read
const CONFIG_POLL_MS = Number(process.env.GG_CONFIG_POLL_MS) || 1000;
// A stall longer than this is forgiven rather than made up in one burst
const MAX_CATCH_UP_MS = 1000;

// Embedded Metric Format: the shape CloudWatch extracts metrics from in a log line. A second's
// readings go out as one array rather than a line per request, since the host parses every
// line on its main thread. A metric is either always about a status or never about one
function putMetric(name, value, unit, status) {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'glass-garden',
            Dimensions: status === undefined ? [[]] : [[], ['status']],
            Metrics: [{ Name: name, Unit: unit }]
          }
        ]
      },
      [name]: value,
      status
    })
  );
}

// Says a message only while it is new, so a failure that repeats every request is said once.
// Called with nothing it forgets, so the next failure is said again
function onChange(say) {
  let last;
  return (message) => {
    if (message && message !== last) say(message);
    last = message;
  };
}

const complainAboutConfig = onChange(console.error);
const complainAboutTarget = onChange(console.error);
const complainAboutCap = onChange(console.error);
const announce = onChange(console.log);

async function readConfig() {
  let contents;
  try {
    contents = await readFile('config.json', 'utf8');
  } catch (error) {
    throw new Error(`Cannot read config.json: ${error.message}`);
  }
  // The canvas may be mid-write, so a torn read is a real event rather than a bug
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`config.json is not valid JSON (${error.message}): ${contents}`);
  }
}

const isJson = (text) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

let config;
let contentType;

// The canvas writes config.json before it starts this process, so there is nothing to fall
// back on at start. After that the last good config stands if a read fails
async function refreshConfig() {
  try {
    config = await readConfig();
    complainAboutConfig();
  } catch (error) {
    if (config === undefined) throw error;
    complainAboutConfig(error.message);
  }
  contentType = isJson(config.body) ? 'application/json' : 'text/plain';
  const { method, path, requestsPerSecond, target } = config;
  announce(
    target === null
      ? 'Nothing to send to: nothing running is wired to this generator'
      : `Sending ${method} ${path} to :${target} at ${requestsPerSecond}/s`
  );
}

let inFlight = 0;
// This second's observations, published together when it ends
let observed = { responses: new Map(), connectionErrors: 0, skipped: 0, lastError: undefined };

// A refused connection arrives as an AggregateError whose own message is empty, one entry per
// address tried, so the code is the only thing that names the failure
const reasonOf = (error) => error.message || error.code || String(error);

// One target, chosen by the canvas. Splitting traffic across several is a load balancer's job
function send() {
  const { target } = config;
  if (target === null) return;
  if (inFlight >= config.maxInFlight) {
    observed.skipped++;
    return;
  }
  inFlight++;
  const { method, path, body } = config;
  const started = Date.now();
  const fail = (error) => {
    observed.connectionErrors++;
    observed.lastError = `:${target} unreachable: ${reasonOf(error)}`;
  };

  const headers = { 'content-length': Buffer.byteLength(body) };
  if (body) headers['content-type'] = contentType;
  const req = http.request({ host: 'localhost', port: target, path, method, headers }, (res) => {
    // The whole round trip as a client sees it, ending with the last byte of the body
    res.resume();
    res.on('error', fail);
    res.on('end', () => {
      const status = String(res.statusCode);
      if (!observed.responses.has(status)) observed.responses.set(status, []);
      observed.responses.get(status).push(Date.now() - started);
    });
  });
  req.on('error', fail);
  // Once, after the response has ended or the request has failed
  req.on('close', () => inFlight--);
  req.end(body);
}

function publish() {
  const { responses, connectionErrors, skipped, lastError } = observed;
  observed = { responses: new Map(), connectionErrors: 0, skipped: 0, lastError: undefined };
  for (const [status, times] of responses) {
    // One reading per response, as every other resource counts them
    putMetric('requests', times.map(() => 1), 'Count', status);
    putMetric('response time', times, 'Milliseconds', status);
  }
  if (connectionErrors > 0) putMetric('connection errors', connectionErrors, 'Count');
  if (skipped > 0) putMetric('skipped requests', skipped, 'Count');
  complainAboutTarget(lastError);
  complainAboutCap(
    skipped > 0
      ? `${config.maxInFlight} requests in flight and no answers yet, so ${skipped} were skipped this second`
      : undefined
  );
}

// Spread evenly over the second. Timers fire late, so a tick sends everything due since the last
async function run() {
  let next = Date.now();
  for (;;) {
    const now = Date.now();
    if (now - next > MAX_CATCH_UP_MS) next = now;
    const interval = METRIC_PERIOD_MS / config.requestsPerSecond;
    while (next <= now) {
      send();
      next += interval;
    }
    await sleep(next - now);
  }
}

// Wrapped whole: an error escaping a VM process exits 0 without a trace
try {
  await refreshConfig();
  // Every count once, so the names are in the Metrics tab before anything happens
  for (const name of ['requests', 'connection errors', 'skipped requests']) {
    putMetric(name, 0, 'Count');
  }
  setInterval(() => void refreshConfig(), CONFIG_POLL_MS);
  setInterval(publish, METRIC_PERIOD_MS);
  await run();
} catch (error) {
  console.error(`Request generator failed: ${error?.stack ?? error}`);
  process.exit(1);
}
