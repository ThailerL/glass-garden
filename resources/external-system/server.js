// Runs the author's api.mjs and counts its calls out of the reader's code's reach
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { bodyOf, putMetric, reportEvent } from './_harness/lib.js';
import { callerIn } from './caller.js';

const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

// The host stores one datapoint per second, so a second travels as one line
const METRIC_PERIOD_MS = 1000;
// Overridable for tests
const REREAD_MS = Number(process.env.GG_REREAD_MS) || 1000;

function nothingObserved() {
  return { responses: new Map(), sent: new Map(), unanswered: 0, readings: new Map() };
}
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
    throw new Error(`The system's code did not load: ${error?.stack ?? error}`);
  }
  if (typeof api.handle !== 'function') {
    throw new Error("The system's code must export a function named handle");
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

// Re-read, so a change needs no restart and the module keeps its memory
let connected = [];
let settings = {};

async function reread(file, last) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    // Not written yet, or caught mid-write: the last one read stands
    return last;
  }
}

async function refresh() {
  [connected, settings] = await Promise.all([
    reread('endpoints.json', connected),
    reread('settings.json', settings)
  ]);
}

// Statuses a Response may not be constructed with a body for
const NULL_BODY = new Set([101, 204, 205, 304]);

// What fetch throws when nothing is listening
function unreachable(name) {
  const cause = Object.assign(new Error(`${name} is not running`), { code: 'ECONNREFUSED' });
  return new TypeError('fetch failed', { cause });
}

function endpoint({ name, port: to }) {
  async function send(path, init) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new TypeError(`send needs a path starting with /, not ${path}`);
    }
    const started = performance.now();
    let response, body;
    try {
      if (to === null) throw unreachable(name);
      reportEvent('hop', { to: { port: to } });
      response = await fetch(`http://localhost:${to}${path}`, init);
      // Read whole, so the time is the round trip as the request generator counts it
      body = NULL_BODY.has(response.status) ? null : await response.arrayBuffer();
    } catch (error) {
      observed.unanswered += 1;
      throw error;
    }
    append(observed.sent, response.status, performance.now() - started);
    return new Response(body, response);
  }
  return { name, send };
}

function endpoints() {
  return connected.map(endpoint);
}

const context = {
  metric,
  endpoints,
  // A copy, so the module cannot change what the next call reads
  settings: () => structuredClone(settings)
};

// 1 per failure and 0 otherwise, so Average is the failure rate
function putExchanges(prefix, exchanges, unanswered = 0) {
  const outcomes = [];
  for (const [status, times] of exchanges) {
    outcomes.push(...times.map(() => (status >= 500 ? 1 : 0)));
    putMetric(`${prefix}requests`, times.map(() => 1), 'Count', { status: String(status) });
    putMetric(`${prefix}response time`, times, 'Milliseconds', { status: String(status) });
  }
  outcomes.push(...Array(unanswered).fill(1));
  if (outcomes.length > 0) putMetric(`${prefix}errors`, outcomes, 'Count');
}

function publish() {
  const { responses, sent, unanswered, readings } = observed;
  observed = nothingObserved();
  putExchanges('', responses);
  putExchanges('outgoing ', sent, unanswered);
  // A quiet count reports 0 for goals to judge, a quiet measurement nothing
  for (const [name, unit] of units) {
    const values = readings.get(name);
    if (values) putMetric(name, values, unit);
    else if (unit === 'Count') putMetric(name, 0, unit);
  }
}

// A standard Request, addressed as if this service were the whole host
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
    if (node !== undefined) reportEvent('hop', { from: { node } });
    try {
      const response = await handle(await requestFrom(req, path), context);
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
  await refresh();
  setInterval(() => void refresh(), REREAD_MS);
  serve(handle).listen(port, () => console.log(`External System running on localhost:${port}`));
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
