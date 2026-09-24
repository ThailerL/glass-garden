// Runs the author's api.mjs and counts its calls out of the reader's code's reach
import http from 'node:http';
import { callerIn } from './caller.js';

const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

// The host stores one datapoint per second, so a second travels as one line
const METRIC_PERIOD_MS = 1000;

// Embedded Metric Format. A metric is either always about a status or never
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

// Drawn from the calling node to this one
const reportHop = (node) =>
  console.log('gg:event ' + JSON.stringify({ kind: 'hop', at: Date.now(), from: { node } }));

// This second's response times by status, and the author's readings
const nothingObserved = () => ({ responses: new Map(), readings: new Map() });
let observed = nothingObserved();
// Every author metric, so a quiet second still reports it
const units = new Map();

function append(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

async function loadHandle() {
  let api;
  try {
    api = await import('./api.mjs');
  } catch (error) {
    throw new Error(`The API's code did not load: ${error?.stack ?? error}`);
  }
  if (typeof api.handle !== 'function') {
    throw new Error('The API\'s code must export a function named handle');
  }
  for (const [name, unit] of Object.entries(api.metrics ?? {})) {
    if (typeof unit !== 'string') throw new Error(`metrics.${name} must be a unit such as 'Count'`);
    units.set(name, unit);
  }
  return api.handle;
}

function metric(name, value, unit = 'Count') {
  if (typeof name !== 'string' || !name) throw new Error('metric needs a name');
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`metric ${name} needs a number, not ${value}`);
  }
  const known = units.get(name);
  if (known && known !== unit) throw new Error(`metric ${name} is in ${known}, not ${unit}`);
  units.set(name, unit);
  append(observed.readings, name, value);
}

function publish() {
  const { responses, readings } = observed;
  observed = nothingObserved();
  // 1 per failure and 0 otherwise, so Average is the failure rate
  const outcomes = [];
  for (const [status, times] of responses) {
    outcomes.push(...times.map(() => (status >= 500 ? 1 : 0)));
    putMetric('requests', times.map(() => 1), 'Count', String(status));
    putMetric('response time', times, 'Milliseconds', String(status));
  }
  if (outcomes.length > 0) putMetric('errors', outcomes, 'Count');
  // A quiet count reports 0 for goals to judge, a quiet measurement nothing
  for (const [name, unit] of units) {
    const values = readings.get(name);
    if (values) putMetric(name, values, unit);
    else if (unit === 'Count') putMetric(name, 0, unit);
  }
}

async function bodyOf(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// A standard Request, addressed as if this API were the whole host
async function requestFrom(req, path) {
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await bodyOf(req);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return new Request(`http://localhost:${port}${path}`, { method: req.method, headers, body });
}

async function answer(res, response) {
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(body);
}

function fail(res, message) {
  console.error(message);
  if (res.headersSent) return res.destroy();
  res.writeHead(500, { 'content-type': 'text/plain' });
  res.end(`${message}\n`);
}

function serve(handle) {
  return http.createServer(async (req, res) => {
    const started = performance.now();
    const { node, path } = callerIn(req.url ?? '/');
    if (node !== undefined) reportHop(node);
    try {
      const response = await handle(await requestFrom(req, path), { metric });
      if (!(response instanceof Response)) {
        fail(res, `handle must return a Response, but ${req.method} ${path} returned ${response}`);
      } else {
        await answer(res, response);
      }
    } catch (error) {
      fail(res, `${req.method} ${path} failed: ${error?.stack ?? error}`);
    }
    append(observed.responses, res.statusCode, performance.now() - started);
  });
}

// An error escaping a VM process exits 0 without a trace
try {
  const handle = await loadHandle();
  // So the Metrics tab names them before anything happens
  putMetric('requests', 0, 'Count');
  putMetric('errors', 0, 'Count');
  publish();
  setInterval(publish, METRIC_PERIOD_MS);
  serve(handle).listen(port, () => console.log(`External API running on localhost:${port}`));
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
