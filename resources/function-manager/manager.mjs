// The Lambda service for one function node: owns the function's port, serves its URL, and
// creates, feeds and reaps the execution environments that run the handler. An environment is
// a child process running runtime.mjs, which speaks the Lambda Runtime API back to this
// process. Hidden from the user; index.mjs in the working directory is theirs
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT);
if (!port) {
  console.error('The function manager needs PORT to be set');
  process.exit(1);
}

const RUNTIME_API_PREFIX = '/2018-06-01/runtime/';
const RUNTIME_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runtime.mjs');
const FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME || 'function';
const FUNCTION_ARN = `arn:aws:lambda:us-east-1:000000000000:function:${FUNCTION_NAME}`;

// The error Lambda answers an invocation it has no concurrency for
const THROTTLED = 'TooManyRequestsException';
// Overridable so tests need not wait a second per re-read
const CONFIG_POLL_MS = Number(process.env.GG_CONFIG_POLL_MS) || 1000;

// Until config.json says otherwise: enough concurrency to be worth watching, few enough
// processes to be harmless
const DEFAULT_CONFIG = { timeout: 3, maxConcurrency: 5 };

// ── Logging ───────────────────────────────────────────────────────────────────────────────

// Lines from an environment carry its id, so the host files them as that environment's
// stream; the manager's own lines are bare
const environmentLine = (id, line) => console.log(`gg:env ${id} ${line}`);

// ── Config ────────────────────────────────────────────────────────────────────────────────

let config = DEFAULT_CONFIG;
// So a file the user is midway through editing complains once rather than every second
let configComplaint;

async function readConfig() {
  let contents;
  try {
    contents = await readFile('config.json', 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return DEFAULT_CONFIG;
    throw new Error(`Cannot read config.json: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`config.json is not valid JSON (${error.message}): ${contents}`);
  }
  const { timeout, maxConcurrency } = parsed ?? {};
  if (!(timeout > 0)) throw new Error(`config.json has no positive timeout: ${contents}`);
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error(`config.json has no positive maxConcurrency: ${contents}`);
  }
  return { timeout, maxConcurrency };
}

// Re-read on a timer rather than at spawn, so a change on the canvas takes effect within a
// second and without relaunching the manager. The last good config stands if a read fails
async function refreshConfig() {
  try {
    config = await readConfig();
    configComplaint = undefined;
  } catch (error) {
    if (configComplaint !== error.message) console.error(error.message);
    configComplaint = error.message;
  }
}

// ── Execution environments ────────────────────────────────────────────────────────────────

const environments = new Map();
const countEnvironments = (test) => [...environments.values()].filter(test).length;
// Invocations waiting for an environment, oldest first
const pending = [];
// Invocations handed to an environment, by request id
const inFlight = new Map();

function spawnEnvironment() {
  const id = randomUUID().slice(0, 8);
  const child = spawn('node', [RUNTIME_SCRIPT], {
    env: {
      ...process.env,
      AWS_LAMBDA_RUNTIME_API: `localhost:${port}`,
      AWS_LAMBDA_LOG_STREAM_NAME: id,
      _HANDLER: 'index.handler',
    },
  });
  const env = {
    id,
    child,
    // Set when the environment first asks for work: its init is over
    readyAt: undefined,
    // The parked /next response, present exactly while the environment is idle
    waiting: undefined,
    invocation: undefined,
    invocations: 0,
  };
  environments.set(id, env);
  console.log(`Starting execution environment ${id}`);

  // By hand rather than node:readline, which emits nothing for a child's piped output under
  // Vivari (vivari-quirks.md)
  const forward = (stream) => {
    let carry = '';
    stream.on('data', (chunk) => {
      const lines = (carry + chunk).split('\n');
      carry = lines.pop();
      for (const line of lines) if (line) environmentLine(id, line);
    });
    stream.on('end', () => {
      if (carry) environmentLine(id, carry);
    });
  };
  forward(child.stdout);
  forward(child.stderr);

  child.on('error', (error) => console.error(`Environment ${id} could not start: ${error.message}`));
  child.on('exit', (code, signal) => {
    if (!environments.delete(id)) return;
    console.log(`gg:env-exit ${id}`);
    if (env.invocation) {
      complete(env.invocation, {
        error: {
          errorType: 'Runtime.ExitError',
          errorMessage: `Runtime exited with error: ${signal ? `signal ${signal}` : `exit status ${code}`}`,
        },
      });
    }
    dispatch();
  });
}

function reap(env, reason) {
  if (!environments.has(env.id)) return;
  console.log(`Stopping execution environment ${env.id}: ${reason}`);
  env.child.kill();
}

// Hands waiting work to idle environments, and starts environments for what is left, up to
// the cap. An environment that is starting will ask for work when it is ready, so only as
// many are started as there are invocations no environment is yet going to take
function dispatch() {
  for (const env of environments.values()) {
    if (pending.length === 0) break;
    if (env.waiting) assign(env, pending.shift());
  }
  let uncovered = pending.length - countEnvironments((env) => !env.readyAt);
  while (uncovered > 0 && environments.size < config.maxConcurrency) {
    spawnEnvironment();
    uncovered--;
  }
}

function assign(env, invocation) {
  const res = env.waiting;
  env.waiting = undefined;
  env.invocation = invocation;
  env.invocations++;
  invocation.environment = env;
  invocation.startedAt = Date.now();
  const budget = invocation.timeout * 1000;
  invocation.timer = setTimeout(() => timeOut(invocation), budget);
  inFlight.set(invocation.id, invocation);
  environmentLine(env.id, `START RequestId: ${invocation.id} Version: $LATEST`);
  res.writeHead(200, {
    'content-type': 'application/json',
    'lambda-runtime-aws-request-id': invocation.id,
    'lambda-runtime-deadline-ms': String(invocation.startedAt + budget),
    'lambda-runtime-invoked-function-arn': FUNCTION_ARN,
  });
  res.end(JSON.stringify(invocation.event));
}

// Lambda's own message and error type. The environment is not reused: a handler that ran
// past its deadline may still be running in it
function timeOut(invocation) {
  const seconds = invocation.timeout.toFixed(2);
  const env = invocation.environment;
  complete(invocation, {
    error: { errorType: 'Sandbox.Timedout', errorMessage: `Task timed out after ${seconds} seconds` },
  });
  reap(env, `timed out after ${seconds} seconds`);
}

function complete(invocation, outcome) {
  if (!inFlight.delete(invocation.id)) return;
  clearTimeout(invocation.timer);
  const env = invocation.environment;
  env.invocation = undefined;
  environmentLine(env.id, `END RequestId: ${invocation.id}`);
  invocation.resolve(outcome);
}

// An environment that is idle or on its way can take one more invocation; a busy one is
// spoken for, and past the cap there is nothing left to start
function capacity() {
  const coming = countEnvironments((env) => env.waiting || !env.readyAt);
  return coming + config.maxConcurrency - environments.size;
}

// One invocation, resolved with { result } or { error: { errorType, errorMessage } }. Lambda
// refuses a synchronous invocation it has no concurrency for rather than queueing it, so a
// caller learns the cap is the reason instead of waiting on it
function invoke(event) {
  return new Promise((resolve) => {
    if (pending.length >= capacity()) {
      console.error(
        `Refused an invocation: all ${config.maxConcurrency} execution environments are busy`,
      );
      return resolve({
        error: { errorType: THROTTLED, errorMessage: 'Rate exceeded' },
      });
    }
    pending.push({ id: randomUUID(), event, timeout: config.timeout, resolve });
    dispatch();
  });
}

// ── The Runtime API, as environments see it ───────────────────────────────────────────────

const respondJson = (res, status, value) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));

function handleRuntimeApi(req, res, route, body) {
  const env = environments.get(req.headers['x-gg-environment'] ?? '');
  if (!env) return respondJson(res, 404, { errorMessage: 'Unknown execution environment' });

  if (req.method === 'GET' && route === 'invocation/next') {
    env.readyAt ??= Date.now();
    env.waiting = res;
    // The environment went away mid-wait: not idle any more, and not to be handed work
    req.on('close', () => {
      if (env.waiting === res) env.waiting = undefined;
    });
    dispatch();
    return;
  }

  const outcome = /^invocation\/([^/]+)\/(response|error)$/.exec(route);
  if (req.method === 'POST' && outcome) {
    const invocation = inFlight.get(outcome[1]);
    if (!invocation || invocation.environment !== env) {
      return respondJson(res, 400, { errorMessage: 'Not this environment’s invocation' });
    }
    let payload = null;
    try {
      if (body.length > 0) payload = JSON.parse(body.toString('utf8'));
    } catch {
      payload = body.toString('utf8');
    }
    complete(invocation, outcome[2] === 'error' ? { error: payload } : { result: payload });
    return respondJson(res, 202, { status: 'OK' });
  }

  // The handler could not even be loaded. The invocation that caused this environment to
  // start fails with the reason, as it does on Lambda, rather than waiting on a spawn loop
  if (req.method === 'POST' && route === 'init/error') {
    let error;
    try {
      error = JSON.parse(body.toString('utf8'));
    } catch {
      error = { errorType: 'Runtime.InitError', errorMessage: body.toString('utf8') };
    }
    console.error(`Environment ${env.id} failed to initialize: ${error.errorMessage}`);
    const invocation = pending.shift();
    if (invocation) invocation.resolve({ error });
    reap(env, 'failed to initialize');
    return respondJson(res, 202, { status: 'OK' });
  }

  respondJson(res, 404, { errorMessage: `No such runtime route: ${req.method} ${route}` });
}

// ── The function URL ──────────────────────────────────────────────────────────────────────

// The event a Lambda function URL sends, in its version 2.0 shape
function httpEvent(req, url, body) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[key] = value;
  }
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers,
    queryStringParameters: Object.fromEntries(url.searchParams),
    requestContext: {
      http: {
        method: req.method,
        path: url.pathname,
        protocol: `HTTP/${req.httpVersion}`,
        sourceIp: req.socket.remoteAddress ?? '',
        userAgent: headers['user-agent'] ?? '',
      },
      timeEpoch: Date.now(),
    },
    body: body.length > 0 ? body.toString('utf8') : undefined,
    isBase64Encoded: false,
  };
}

// A function URL's response rules: a string is sent as text, an object carrying statusCode
// or body is a response, anything else is sent as JSON
function sendHttpResult(res, result) {
  if (typeof result === 'string') {
    return res.writeHead(200, { 'content-type': 'text/plain' }).end(result);
  }
  if (result && typeof result === 'object' && ('statusCode' in result || 'body' in result)) {
    const { statusCode = 200, headers = {}, body = '', isBase64Encoded = false } = result;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return res
      .writeHead(statusCode, { 'content-type': 'application/json', ...headers })
      .end(isBase64Encoded ? Buffer.from(text, 'base64') : text);
  }
  respondJson(res, 200, result ?? null);
}

async function handleHttp(req, res, url, body) {
  const outcome = await invoke(httpEvent(req, url, body));
  // What a function URL answers when the handler fails or the function is at its cap; the
  // details are in the log
  if (outcome.error) {
    const { errorType, errorMessage } = outcome.error;
    if (errorType === THROTTLED) {
      res.setHeader('x-amzn-errortype', THROTTLED);
      return respondJson(res, 429, { message: errorMessage });
    }
    return respondJson(res, 502, { message: 'Internal Server Error', errorType, errorMessage });
  }
  sendHttpResult(res, outcome.result);
}

// ── Boot ──────────────────────────────────────────────────────────────────────────────────

// Wrapped whole: an error escaping a VM process exits 0 without a trace
try {
  await refreshConfig();
  setInterval(() => void refreshConfig(), CONFIG_POLL_MS);

  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith(RUNTIME_API_PREFIX)) {
        handleRuntimeApi(req, res, url.pathname.slice(RUNTIME_API_PREFIX.length), body);
      } else {
        await handleHttp(req, res, url, body);
      }
    } catch (error) {
      console.error(`${req.method} ${req.url} failed: ${error.stack ?? error.message}`);
      if (!res.headersSent) respondJson(res, 500, { message: 'Internal Server Error' });
    }
  });

  server.on('error', (error) => {
    console.error(`The function manager could not listen on ${port}: ${error.message}`);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(`Function ready on http://localhost:${port}`);
  });
} catch (error) {
  console.error(`Function manager failed to start: ${error?.stack ?? error}`);
  process.exit(1);
}
