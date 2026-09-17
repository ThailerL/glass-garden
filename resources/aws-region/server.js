// The region bridge. Boots the vendored emulator from ./cache, restores persisted state, then
// serves two surfaces on one port through pocket-region's serve (the emulator cannot listen
// under Pyodide): the AWS data plane (enforced against the topology, then handed to the
// emulator in-process) and /control/* for the host manager (token-guarded). Functions run
// inside pocket-region too; what their execution environments do is reported here
import fs from 'node:fs';
import path from 'node:path';
import { deprovision, provision } from './provision.js';
import { sampleStats } from './stats.js';
import { textOf } from './aws-api.js';
import { invocationSource } from './function-events.js';
import { functionUrl } from './function-url.js';
import {
  EVENT_PREFIX,
  decideRequest,
  emptyTopology,
  denialResponse,
  extractResourceNames,
  parseCredential,
  receivedMessages,
} from './lib.js';
import { SaveScheduler } from './save-scheduler.js';

const PORT = Number(process.env.PORT);
// A per-boot secret the host manager generates and passes at spawn. /control/* shares
// this port with the AWS API that user code can reach on localhost, so control requests
// must present the token in an x-gg-token header; user code is never given it
const TOKEN = process.env.GG_CONTROL_TOKEN;
if (!PORT) throw new Error('PORT is not set');
if (!TOKEN) throw new Error('GG_CONTROL_TOKEN is not set');

const CACHE_DIR = path.resolve('cache');
const DATA_DIR = path.resolve('data');
// The canvas, as the host last wrote it. A file rather than a control call so it is already
// on disk before this process starts: a request can never be judged against an empty one
const TOPOLOGY_FILE = path.resolve('topology.json');
// A lone action is saved at once; these two bound the burst behind it. They also bound what a
// reload loses, since nothing stops the region on unload. A save costs 7-18ms at 5-55KB of
// state and 46ms at 677KB
const SAVE_DEBOUNCE_MS = 500;
const SAVE_MAX_WAIT_MS = 1000;
const SAMPLE_INTERVAL_MS = 1000;
// The host stores one datapoint per second, so a level reported less often leaves gaps
const LEVEL_PERIOD_MS = 1000;

// Everything the bridge itself reports; bare stdout/stderr only relays Python output.
// The manager routes anything carrying a nodeId to that node and keeps the rest
const emit = (event) => console.log(EVENT_PREFIX + JSON.stringify(event));
const emitLog = (level, message, nodeId) => emit({ kind: 'log', level, message, nodeId });
const putMetric = (nodeId, name, value, unit, dimensions) =>
  emit({ kind: 'metric', nodeId, name, value, unit, dimensions });
const emitHop = (from, to, count) =>
  emit({ kind: 'hop', at: Date.now(), from: { node: from }, to: { node: to }, count });
const emitLevel = (nodeId, value, capacity) =>
  emit({ kind: 'level', at: Date.now(), nodeId, value, capacity });

// ── Functions ─────────────────────────────────────────────────────────────────────────────

// What the bridge knows about each function beyond the emulator's own record: the cap the
// node was provisioned with, for the gauge, and how many invocations are running right now
const functions = new Map();
const functionState = (name) => {
  let state = functions.get(name);
  if (!state) {
    state = { maxConcurrency: undefined, busy: 0, beat: undefined };
    functions.set(name, state);
  }
  return state;
};

// A level rather than a tally, so the chart reads as what is running right now. It keeps
// reporting itself while there is work and falls silent when there is none, since a period
// with no samples is a gap rather than a zero
function reportConcurrency(name, nodeId) {
  const state = functionState(name);
  putMetric(nodeId, 'concurrent executions', state.busy, 'Count');
  emitLevel(nodeId, state.busy, state.maxConcurrency);
  if (state.busy > 0 && !state.beat) {
    state.beat = setInterval(() => reportConcurrency(name, nodeId), LEVEL_PERIOD_MS);
  } else if (state.busy === 0 && state.beat) {
    clearInterval(state.beat);
    state.beat = undefined;
  }
}

// A triggered invocation is the one crossing of an edge the front door never sees: the
// batch or notification reached the function inside the emulator. The event names the source
function reportTrigger(nodeId, eventText, owners) {
  const source = invocationSource(eventText);
  if (!source) return;
  const from = owners[source.service]?.[source.name];
  if (from) emitHop(from, nodeId, source.count);
  if (source.service === 'sqs') putMetric(nodeId, 'batches', 1, 'Count', { queue: source.name });
  else putMetric(nodeId, 'notifications', 1, 'Count', { bucket: source.name });
}

// Each function's URL listens on its node's reserved port, which the topology carries.
// Reconciled whenever the canvas changes: a function that appears gets a listener, one
// that goes loses it, and a port that moved is closed before it is opened elsewhere
const urlListeners = new Map();

// One provisioning at a time per resource. A save and a config change can deploy the same
// function together, and both would find it missing and both try to create it
const provisioning = new Map();
function serially(key, work) {
  const run = (provisioning.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  provisioning.set(key, run);
  return run;
}

// The canvas as the observer reads it. A handler can print a line a millisecond, which is no
// rate to read a file at, so it is refreshed with the listeners instead
let observed = emptyTopology();

// What pocket-region reports about execution environments, routed to the function's node.
// Environment output is its own stream in the node's log, and each measurement carries the
// environment so the per-environment lines add up to the total, as CloudWatch's do
const observer = {
  onOutput(line, { functionName, environment }) {
    const nodeId = observed.owners.lambda[functionName];
    if (nodeId) emit({ kind: 'output', nodeId, environment, line });
  },
  onEvent(event) {
    const { owners } = observed;
    const nodeId = owners.lambda[event.functionName];
    if (!nodeId) return;
    const { environment } = event;
    if (event.kind === 'environment') {
      if (event.phase === 'stopped') emit({ kind: 'environment-exit', nodeId, environment });
    } else if (event.phase === 'started') {
      functionState(event.functionName).busy += 1;
      if (event.coldStart) putMetric(nodeId, 'cold starts', 1, 'Count', { environment });
      reportTrigger(nodeId, event.event, owners);
      reportConcurrency(event.functionName, nodeId);
    } else {
      functionState(event.functionName).busy -= 1;
      putMetric(nodeId, 'invocations', 1, 'Count', { environment });
      putMetric(nodeId, 'duration', event.durationMs, 'Milliseconds', { environment });
      if (event.failed) putMetric(nodeId, 'errors', 1, 'Count', { environment });
      reportConcurrency(event.functionName, nodeId);
    }
  }
};

// Explicit try/catch around the whole boot: in Vivari, a rejected top-level await exits 0
// and prints nothing
try {
console.log('Starting the Python runtime');
const meta = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'meta.json'), 'utf8'));

// Verify every size, so a bad copy fails loudly here instead of somewhere inside Python
for (const file of meta.files) {
  const stats = fs.statSync(path.join(CACHE_DIR, file.path), { throwIfNoEntry: false });
  if (stats?.size !== file.bytes) {
    throw new Error(`cache file ${file.path} is ${stats?.size ?? 'missing'}, expected ${file.bytes}`);
  }
}
const { createRegion, directoryStore, serve } = await import('./cache/pocket-region.js');
// Explicit indexURL: without it pyodide self-locates via fileURLToPath(import.meta.url),
// which Vivari's module shim cannot satisfy. Restoring from the store and saving back to it
// are pocket-region's, including the shuttle through MEMFS that Vivari's corrupt writes
// through a node mount force
const region = await createRegion({
  packageCacheDir: CACHE_DIR,
  indexURL: path.join(CACHE_DIR, 'pyodide'),
  store: directoryStore(DATA_DIR),
  // Queue URLs are built from this, and the SDK dials the URL it is given
  port: PORT,
  onOutput: (line, stream) => (stream === 'stderr' ? console.error(line) : console.log(line)),
  lambda: observer
});
// What restoring found is pocket-region's to report, and it says so on its own output: a
// state file whose format the emulator refuses is quarantined and that service starts empty.
// Counting the files from out here would only re-derive its private layout, and would say
// "restored" about a file that was refused
emitLog('info', `Serving ${meta.emulatorSpec} (pocket-region ${meta.pocketRegionVersion})`);

// The one way to see the canvas, and it reads fresh every time: the host rewrites the
// file whenever the graph changes, and an accessor makes holding a stale copy impossible
// rather than merely discouraged. The file is a few hundred bytes
function currentTopology() {
  try {
    return JSON.parse(fs.readFileSync(TOPOLOGY_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      emitLog('error', `Could not read the canvas layout: ${error?.message || error}`);
    }
    return emptyTopology();
  }
}
// In the boot block, beside the region, serve and the canvas it reads
async function reconcileFunctionUrls() {
  observed = currentTopology();
  const { owners, ports } = observed;
  const wanted = new Map();
  for (const [functionName, nodeId] of Object.entries(owners.lambda)) {
    if (ports[nodeId] !== undefined) wanted.set(nodeId, { functionName, port: ports[nodeId] });
  }
  for (const [nodeId, listener] of urlListeners) {
    const want = wanted.get(nodeId);
    if (want && want.port === listener.port && want.functionName === listener.functionName) continue;
    urlListeners.delete(nodeId);
    await listener.server.close().catch(() => {});
  }
  for (const [nodeId, { functionName, port }] of wanted) {
    if (urlListeners.has(nodeId)) continue;
    try {
      const server = await serve(functionUrl(region, functionName), { port });
      urlListeners.set(nodeId, { functionName, port, server });
    } catch (error) {
      emitLog('error', `Could not serve the function URL on port ${port}: ${error?.message || error}`, nodeId);
    }
  }
}

// Reported once rather than every tick, so a lasting failure does not bury the log
let sampleFailed = false;

// Every successful data-plane request tells the scheduler something changed; it decides when
// the write happens. Both calls are synchronous, so a save can never overlap another
const saves = new SaveScheduler({
  debounceMs: SAVE_DEBOUNCE_MS,
  maxWaitMs: SAVE_MAX_WAIT_MS,
  // Written into MEMFS, then mirrored to the persistent data dir. It does not await, so
  // the failure path is the rejection rather than a catch
  save: () => {
    void region.save().catch((error) => {
      emitLog('error', `Saving state failed: ${error?.message || error}`);
    });
  },
});

// A resource's own node hears about the traffic reaching it. Denials are reported against
// the caller instead - that is who has to draw the edge - so they are not counted here
function reportRequest(owner, method, pathname, status) {
  putMetric(owner, 'requests', 1, 'Count');
  if (status >= 400) putMetric(owner, 'errors', 1, 'Count');
  emitLog('info', `${method} ${pathname} ${status}`, owner);
}

// The same request as a hop for the canvas, which only the region can name both ends of:
// toward the resource for most calls, back from a queue for what a receive returned, and
// nothing for a delete, which is the receive's housekeeping
function reportHop(owner, caller, target, received) {
  if (target === 'AmazonSQS.ReceiveMessage') {
    if (received.length > 0) emitHop(owner, caller, received.length);
  } else if (!target?.startsWith('AmazonSQS.DeleteMessage')) {
    emitHop(caller, owner);
  }
}

// What a resource is holding, sampled on a timer because there is no request to hang it off.
// The calls go straight to the emulator rather than round the socket, so the sampling is
// never judged by the ladder below and never shows up as traffic the user did not cause
async function sampleResources() {
  const { owners } = currentTopology();
  let stats;
  try {
    stats = await sampleStats(region, owners);
  } catch (error) {
    if (!sampleFailed) emitLog('error', `Could not read resource stats: ${error?.message || error}`);
    sampleFailed = true;
    return;
  }
  sampleFailed = false;
  for (const [service, byName] of Object.entries(stats)) {
    for (const [name, readings] of Object.entries(byName)) {
      const nodeId = owners[service]?.[name];
      if (!nodeId) continue;
      for (const [metric, [value, unit]] of Object.entries(readings)) {
        putMetric(nodeId, metric, value, unit);
      }
      // What is waiting, for the queue's gauge
      if (service === 'sqs') {
        emit({ kind: 'level', at: Date.now(), nodeId, value: readings.messages[0] });
      }
    }
  }
}

const encoder = new TextEncoder();
const respond = (status, contentType, body) => ({
  status,
  headers: { 'content-type': contentType },
  body: encoder.encode(body)
});
const json = (status, value) => respond(status, 'application/json', JSON.stringify(value));
const denied = (service, denial) => {
  const answer = denialResponse(service, denial);
  return respond(answer.status, answer.contentType, answer.body);
};

async function handleControl(request, url) {
  if (request.headers['x-gg-token'] !== TOKEN) return json(403, { message: 'bad token' });
  const route = `${request.method} ${url.pathname}`;
  if (route === 'GET /control/health') {
    return json(200, {
      status: 'ok',
      emulator: meta.emulatorSpec,
      pocketRegion: meta.pocketRegionVersion
    });
  }
  if (route === 'POST /control/provision') {
    const { service, name, config } = JSON.parse(textOf(request));
    const created = await serially(`${service}:${name}`, () =>
      provision(region, service, name, config ?? {})
    );
    if (service === 'lambda') functionState(name).maxConcurrency = config.maxConcurrency;
    saves.arm();
    return json(200, created);
  }
  if (route === 'POST /control/deprovision') {
    const { service, name } = JSON.parse(textOf(request));
    await serially(`${service}:${name}`, () => deprovision(region, service, name));
    if (service === 'lambda') {
      clearInterval(functions.get(name)?.beat);
      functions.delete(name);
    }
    saves.arm();
    return json(200, { removed: name });
  }
  // The host rewrote topology.json; what is served per node follows it
  if (route === 'POST /control/topology') {
    await reconcileFunctionUrls();
    return json(200, { functions: urlListeners.size });
  }
  if (route === 'POST /control/stop') {
    saves.stop();
    // Lifespan shutdown writes the state files on its way out; the mirror follows
    try {
      await region.stop();
    } catch (error) {
      emitLog('error', `Final save failed: ${error?.message || error}`);
    }
    // Long enough for serve to write the answer first
    setTimeout(() => process.exit(0), 50);
    return json(200, { stopped: true });
  }
  return json(404, { message: `no such control route: ${route}` });
}

async function handleAws(request, url) {
  const topology = currentTopology();
  const credential = parseCredential(request.headers.authorization);
  const service = credential?.service;
  const bodyText = service === 'sqs' || service === 'dynamodb' ? textOf(request) : undefined;
  const resourceNames = extractResourceNames(service, url.pathname, bodyText, request.headers);
  // The first is the one the request is addressed to, which is where its traffic is attributed
  const [resourceName] = resourceNames;
  const decision = decideRequest({ credential, resourceNames }, topology);
  if (!decision.allow) {
    emitLog(
      'error',
      `Denied ${request.method} ${url.pathname}: ${decision.message}`,
      decision.nodeId
    );
    return denied(service, decision);
  }
  const caller = topology.principals[credential.accessKeyId]?.nodeId;
  const answer = await region.dispatch(request);
  const { status } = answer;
  const owner = topology.owners[service]?.[resourceName];
  // A function's numbers come from watching it run, not from its front door, which would
  // count an invoke twice; what the door alone can see is who called
  if (service === 'lambda') {
    if (owner && caller && status < 300) emitHop(caller, owner);
    return answer;
  }
  const target = request.headers['x-amz-target'];
  const receive = target === 'AmazonSQS.ReceiveMessage';
  const received = receive ? receivedMessages(textOf(answer)) : [];
  // A long poll that found nothing is not traffic anyone sent: a function polls forever
  if (status < 300 && receive && received.length === 0) return answer;
  if (owner) {
    reportRequest(owner, request.method, url.pathname, status);
    if (caller) reportHop(owner, caller, target, received);
  }
  // Reads don't arm a save; SQS and DynamoDB reads are POSTs, but ReceiveMessage mutates
  // visibility state anyway, so POST always arms
  if (status < 300 && request.method !== 'GET' && request.method !== 'HEAD') saves.arm();
  return answer;
}

async function dispatch(request) {
  const url = new URL(request.path, 'http://localhost');
  const handler = url.pathname.startsWith('/control/') ? handleControl : handleAws;
  try {
    return await handler(request, url);
  } catch (error) {
    emitLog('error', `${request.method} ${url.pathname} failed: ${error.message}`);
    return json(500, { message: 'internal error' });
  }
}

await serve({ dispatch }, { port: PORT });
console.log(`Region listening on port ${PORT}`);
await reconcileFunctionUrls();
// Re-armed after each sample rather than on a fixed interval: a canvas holding enough for a
// sample to outlast the interval would otherwise stack them, and they contend for the one
// interpreter serving the data plane
const sampleAgain = () => setTimeout(() => void sampleResources().finally(sampleAgain), SAMPLE_INTERVAL_MS);
sampleAgain();
} catch (error) {
  // Firefox's stack carries no message line, and without one the log only names frames
  const stack = error?.stack ?? '';
  console.log(`Region failed to start: ${stack.startsWith(String(error)) ? stack : `${error}\n${stack}`}`);
  process.exit(1);
}
