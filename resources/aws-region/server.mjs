// The region bridge. Owns the only socket (Python cannot listen under Pyodide), boots
// the vendored Python runtime from ./cache, restores persisted state, then serves two
// surfaces on one port: the AWS data plane (enforced against the topology, then handed
// to the emulator in-process) and /control/* for the host manager (token-guarded).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  EVENT_PREFIX,
  decideRequest,
  emptyTopology,
  denialResponse,
  extractResourceName,
  parseCredential,
} from './lib.mjs';

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
// The MEMFS staging dir for persistence; injected into Python, which names the files
const STATE_ROOT = '/state';
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const SAVE_DEBOUNCE_MS = 500;
// Caps how much a reload can lose: nothing stops the region on unload, so unsaved state
// is gone. A save costs 7-18ms at 5-55KB of state and 46ms at 677KB
const SAVE_MAX_WAIT_MS = 1000;
const SAMPLE_INTERVAL_MS = 1000;
// Executed in this order into one shared global namespace; threads.py must land before
// helpers.py imports the emulator, and api.py defines the gg_* functions the bridge calls
const PYTHON_FILES = ['threads.py', 'helpers.py', 'api.py'];

// Everything the bridge itself reports; bare stdout/stderr only relays Python output.
// The manager routes anything carrying a nodeId to that node and keeps the rest
const emit = (event) => console.log(EVENT_PREFIX + JSON.stringify(event));
const emitLog = (level, message, nodeId) => emit({ kind: 'log', level, message, nodeId });
const putMetric = (nodeId, name, value, unit) =>
  emit({ kind: 'metric', nodeId, name, value, unit });

// Explicit try/catch around the whole boot: Vivari neither surfaces uncaught VM errors
// nor implements the process-level error events
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
const { loadPyodide } = await import('./cache/pyodide/pyodide.mjs');
// Explicit indexURL: without it pyodide self-locates via fileURLToPath(import.meta.url),
// which Vivari's module shim cannot satisfy
const py = await loadPyodide({
  indexURL: path.join(CACHE_DIR, 'pyodide'),
  packageCacheDir: path.join(CACHE_DIR, 'wheels')
});
// Before any Python runs: print throws EBADF without these
py.setStdout({ batched: (line) => console.log(line) });
py.setStderr({ batched: (line) => console.error(line) });
await py.loadPackage(['micropip', ...meta.distPackages]);
py.FS.mkdirTree('/wheels');
py.mountNodeFS('/wheels', path.join(CACHE_DIR, 'wheels'));

// Python file IO stays in MEMFS (/state, /tmp): writes through a node mount return
// corrupt lengths under Vivari, so the bridge shuttles the bytes itself
function copyDiskToMemfs(diskDir, memDir) {
  py.FS.mkdirTree(memDir);
  for (const entry of fs.readdirSync(diskDir, { withFileTypes: true })) {
    const disk = path.join(diskDir, entry.name);
    const mem = `${memDir}/${entry.name}`;
    if (entry.isDirectory()) copyDiskToMemfs(disk, mem);
    else py.FS.writeFile(mem, fs.readFileSync(disk));
  }
}

function listMemfsFiles(memDir, found = []) {
  for (const name of py.FS.readdir(memDir)) {
    if (name === '.' || name === '..') continue;
    const mem = `${memDir}/${name}`;
    if (py.FS.isDir(py.FS.stat(mem).mode)) listMemfsFiles(mem, found);
    else found.push(mem);
  }
  return found;
}

function listDiskFiles(diskDir, found = []) {
  for (const entry of fs.readdirSync(diskDir, { withFileTypes: true })) {
    const disk = path.join(diskDir, entry.name);
    if (entry.isDirectory()) listDiskFiles(disk, found);
    else found.push(disk);
  }
  return found;
}

// Mirror the emulator's state tree out of MEMFS. Deletions count as much as writes: a
// deleted object whose file survived on disk would reappear at the next boot
function persistState() {
  const written = new Set();
  for (const mem of listMemfsFiles(STATE_ROOT)) {
    const disk = path.join(DATA_DIR, mem.slice(STATE_ROOT.length + 1));
    written.add(disk);
    fs.mkdirSync(path.dirname(disk), { recursive: true });
    fs.writeFileSync(disk, Buffer.from(py.FS.readFile(mem)));
  }
  for (const disk of listDiskFiles(DATA_DIR)) {
    if (!written.has(disk)) fs.rmSync(disk);
  }
}

fs.mkdirSync(DATA_DIR, { recursive: true });
copyDiskToMemfs(DATA_DIR, STATE_ROOT);
const wheels = meta.pypiWheels.map((file) => `'emfs:/wheels/${file}'`).join(', ');
await py.runPythonAsync(`import micropip\nawait micropip.install([${wheels}], deps=False)`);
py.globals.set('STATE_ROOT', STATE_ROOT);
// Queue URLs are built from this, and the SDK dials the URL it is given
py.globals.set('REGION_PORT', PORT);
for (const file of PYTHON_FILES) {
  await py.runPythonAsync(fs.readFileSync(file, 'utf8'));
}
// Each service reloads its own state file as it imports; lifespan startup finishes the job
const startup = JSON.parse(await py.runPythonAsync('await gg_start()'));
// The emulator persists every service it implements, not just the three we serve, so this
// counts files rather than listing them; /control/health carries the detail
emitLog(
  'info',
  `Serving ministack ${meta.ministackVersion} with ${startup.stateFiles.length} state files,` +
    ` ${startup.deferred.length} background workers deferred`
);
if (startup.failed.length) {
  emitLog('error', `Background workers failed: ${startup.failed.join('; ')}`);
}
// Callable proxies to the Python functions: calling the emulator is a function call,
// not a network hop
const dispatch = py.globals.get('gg_dispatch');
const provision = py.globals.get('gg_provision');
const deprovision = py.globals.get('gg_deprovision');
const saveState = py.globals.get('save_state');
const shutdownEmulator = py.globals.get('gg_stop');
const readStats = py.globals.get('gg_stats');

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
// Reported once rather than every tick, so a lasting failure does not bury the log
let sampleFailed = false;

// Save on quiesce: every successful data-plane request re-arms a short debounce, with a
// max wait so a sustained burst cannot hold the window open indefinitely
let saveTimer;
let saveDeadline;
let saveRunning = false;
let savePending = false;
let stopping = false;

function armSave() {
  if (stopping) return;
  const now = Date.now();
  saveDeadline ??= now + SAVE_MAX_WAIT_MS;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(runSave, Math.max(Math.min(SAVE_DEBOUNCE_MS, saveDeadline - now), 0));
}

function runSave() {
  saveDeadline = undefined;
  if (saveRunning) {
    savePending = true;
    return;
  }
  saveRunning = true;
  try {
    // Written into MEMFS, then mirrored to the persistent data dir
    saveState();
    persistState();
  } catch (error) {
    emitLog('error', `Saving state failed: ${error?.message || error}`);
  }
  saveRunning = false;
  if (savePending) {
    savePending = false;
    armSave();
  }
}

// A resource's own node hears about the traffic reaching it. Denials are reported against
// the caller instead - that is who has to draw the edge - so they are not counted here
function reportRequest(owners, service, resourceName, method, pathname, status) {
  const nodeId = owners[service]?.[resourceName];
  if (!nodeId) return;
  putMetric(nodeId, 'requests', 1, 'Count');
  if (status >= 400) putMetric(nodeId, 'errors', 1, 'Count');
  emitLog('info', `${method} ${pathname} ${status}`, nodeId);
}

// What a resource is holding, sampled on a timer because there is no request to hang it off.
// Read straight from the emulator rather than through the data plane, so the sampling does
// not show up as traffic the user never caused
async function sampleResources() {
  const { owners } = currentTopology();
  let stats;
  try {
    stats = JSON.parse(await readStats());
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
    }
  }
}

const respond = (res, status, contentType, body) => {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
};
const json = (res, status, value) => respond(res, status, 'application/json', JSON.stringify(value));

async function handleControl(req, res, url, body) {
  if (req.headers['x-gg-token'] !== TOKEN) return json(res, 403, { message: 'bad token' });
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /control/health') return json(res, 200, { status: 'ok', startup });
  if (route === 'POST /control/provision') {
    const { service, name, config } = JSON.parse(body.toString());
    const result = await provision(service, name, JSON.stringify(config ?? {}));
    armSave();
    return respond(res, 200, 'application/json', result);
  }
  if (route === 'POST /control/deprovision') {
    const { service, name } = JSON.parse(body.toString());
    await deprovision(service, name);
    armSave();
    return json(res, 200, { removed: name });
  }
  if (route === 'POST /control/stop') {
    stopping = true;
    clearTimeout(saveTimer);
    // Lifespan shutdown writes the state files on its way out; the mirror follows
    try {
      await shutdownEmulator();
      persistState();
    } catch (error) {
      emitLog('error', `Final save failed: ${error?.message || error}`);
    }
    json(res, 200, { stopped: true });
    setTimeout(() => process.exit(0), 50);
    return;
  }
  json(res, 404, { message: `no such control route: ${route}` });
}

async function handleAws(req, res, url, body) {
  const topology = currentTopology();
  const credential = parseCredential(req.headers.authorization);
  const service = credential?.service;
  const bodyText =
    service === 'sqs' || service === 'dynamodb' ? body.toString('utf8') : undefined;
  const resourceName = extractResourceName(service, url.pathname, bodyText);
  const decision = decideRequest({ credential, resourceName }, topology);
  if (!decision.allow) {
    emitLog(
      'error',
      `Denied ${req.method} ${url.pathname}: ${decision.message}`,
      decision.nodeId
    );
    const denial = denialResponse(service, decision);
    return respond(res, denial.status, denial.contentType, denial.body);
  }

  // The caller's request reaches the emulator verbatim; only content-length is recomputed
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string' && key !== 'content-length') headers[key] = value;
  }
  // A plain Uint8Array view: pyodide's to_bytes rejects the Buffer subclass
  const [status, headersJson, responseBody] = await dispatch(
    req.method,
    req.url,
    JSON.stringify(headers),
    new Uint8Array(body.buffer, body.byteOffset, body.length)
  );
  res.writeHead(status, Object.fromEntries(JSON.parse(headersJson)));
  res.end(responseBody);
  // A long poll that found nothing changed nothing and is not traffic anyone sent: a
  // function polls its trigger queue every 20 s forever
  if (status < 300 && isEmptyReceive(req.headers['x-amz-target'], responseBody)) return;
  reportRequest(topology.owners, service, resourceName, req.method, url.pathname, status);
  // Reads don't arm a save; SQS and DynamoDB reads are POSTs, but ReceiveMessage mutates
  // visibility state anyway, so POST always arms
  if (status < 300 && req.method !== 'GET' && req.method !== 'HEAD') armSave();
}

function isEmptyReceive(target, responseBody) {
  if (target !== 'AmazonSQS.ReceiveMessage') return false;
  return !Buffer.from(responseBody).toString('utf8').includes('"Messages"');
}

const server = http.createServer((req, res) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      emitLog('error', `Rejected ${req.method} ${req.url}: body larger than ${MAX_BODY_BYTES} bytes`);
      json(res, 413, { message: 'request body too large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://localhost');
    const handler = url.pathname.startsWith('/control/') ? handleControl : handleAws;
    handler(req, res, url, body).catch((error) => {
      emitLog('error', `${req.method} ${url.pathname} failed: ${error.message}`);
      if (!res.headersSent) json(res, 500, { message: 'internal error' });
    });
  });
});

server.listen(PORT, () => {
  console.log(`Region listening on port ${PORT}`);
});
setInterval(() => void sampleResources(), SAMPLE_INTERVAL_MS);
} catch (error) {
  console.log(`Region failed to start: ${error?.stack ?? error}`);
  process.exit(1);
}
