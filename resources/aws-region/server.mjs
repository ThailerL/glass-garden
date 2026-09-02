// The region bridge. Owns the only socket (Python cannot listen under Pyodide), boots
// the vendored Python runtime from ./cache, restores persisted state, then serves two
// surfaces on one port: the AWS data plane (enforced against the topology, then handed
// to the emulator in-process) and /control/* for the manager and agents (token-guarded).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  EVENT_PREFIX,
  decideRequest,
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
// The MEMFS staging dir for persistence; injected into Python, which names the files
const STATE_ROOT = '/state';
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const SAVE_DEBOUNCE_MS = 500;
const SAVE_MAX_WAIT_MS = 10_000;
// Executed in this order into one shared global namespace; threads.py must land before
// helpers.py imports the emulator, and api.py defines the gg_* functions the bridge calls
const PYTHON_FILES = ['threads.py', 'helpers.py', 'api.py'];

// Everything the bridge itself reports; bare stdout/stderr only relays Python output.
// The manager routes events with a nodeId to that node's log and keeps the rest
const emitEvent = (level, message, nodeId) =>
  console.log(EVENT_PREFIX + JSON.stringify({ level, message, nodeId }));

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
for (const file of PYTHON_FILES) {
  await py.runPythonAsync(fs.readFileSync(file, 'utf8'));
}
// Each service reloads its own state file as it imports; lifespan startup finishes the job
const startup = JSON.parse(await py.runPythonAsync('await gg_start()'));
// The emulator persists every service it implements, not just the three we serve, so this
// counts files rather than listing them; /control/health carries the detail
emitEvent(
  'info',
  `Serving ministack ${meta.ministackVersion} with ${startup.stateFiles.length} state files,` +
    ` ${startup.deferred.length} background workers deferred`
);
if (startup.failed.length) {
  emitEvent('error', `Background workers failed: ${startup.failed.join('; ')}`);
}
// Callable proxies to the Python functions: calling the emulator is a function call,
// not a network hop
const dispatch = py.globals.get('gg_dispatch');
const provision = py.globals.get('gg_provision');
const deprovision = py.globals.get('gg_deprovision');
const saveState = py.globals.get('save_state');
const shutdownEmulator = py.globals.get('gg_stop');

let topology = { services: [], principals: {} };

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
    emitEvent('error', `Saving state failed: ${error?.message || error}`);
  }
  saveRunning = false;
  if (savePending) {
    savePending = false;
    armSave();
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
  if (route === 'POST /control/topology') {
    topology = JSON.parse(body.toString());
    return json(res, 200, { services: topology.services });
  }
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
      emitEvent('error', `Final save failed: ${error?.message || error}`);
    }
    json(res, 200, { stopped: true });
    setTimeout(() => process.exit(0), 50);
    return;
  }
  json(res, 404, { message: `no such control route: ${route}` });
}

async function handleAws(req, res, url, body) {
  const credential = parseCredential(req.headers.authorization);
  const service = credential?.service;
  const bodyText =
    service === 'sqs' || service === 'dynamodb' ? body.toString('utf8') : undefined;
  const resourceName = extractResourceName(service, url.pathname, bodyText);
  const decision = decideRequest({ credential, resourceName }, topology);
  if (!decision.allow) {
    emitEvent(
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
  // Reads don't arm a save; SQS and DynamoDB reads are POSTs, but ReceiveMessage mutates
  // visibility state anyway, so POST always arms
  if (status < 300 && req.method !== 'GET' && req.method !== 'HEAD') armSave();
}

const server = http.createServer((req, res) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      emitEvent('error', `Rejected ${req.method} ${req.url}: body larger than ${MAX_BODY_BYTES} bytes`);
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
      emitEvent('error', `${req.method} ${url.pathname} failed: ${error.message}`);
      if (!res.headersSent) json(res, 500, { message: 'internal error' });
    });
  });
});

server.listen(PORT, () => {
  console.log(`Region listening on port ${PORT}`);
});
} catch (error) {
  console.log(`Region failed to start: ${error?.stack ?? error}`);
  process.exit(1);
}
