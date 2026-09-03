// The Lambda service for one function node: owns the function's port, serves its URL, and
// creates, feeds and reaps the execution environments that run the handler. An environment is
// a child process running runtime.mjs, which speaks the Lambda Runtime API back to this
// process. Hidden from the user; index.mjs in the working directory is theirs
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
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
const ENDPOINT = process.env.AWS_ENDPOINT_URL;
const ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;

// Lambda's defaults for an SQS event source mapping
const BATCH_SIZE = 10;
const WAIT_SECONDS = 20;
const RECEIVE_TIMEOUT_MS = 30_000;
const POLL_RETRY_MS = 5000;
// How often a poller with nothing free to run on looks again
const SLOT_WAIT_MS = 100;

// The error Lambda answers an invocation it has no concurrency for
const THROTTLED = 'TooManyRequestsException';
// The host stores one datapoint per second, so a level reported less often leaves gaps
const METRIC_PERIOD_MS = 1000;
// Overridable so tests need not wait a second per re-read
const CONFIG_POLL_MS = Number(process.env.GG_CONFIG_POLL_MS) || 1000;
// Lambda keeps a warm environment for minutes; shorter here so a cold start stays visible
// under hand-driven traffic
const IDLE_MS = Number(process.env.GG_IDLE_MS) || 60_000;
// An environment that never asks for work is broken, whatever it is doing
const INIT_TIMEOUT_MS = Number(process.env.GG_INIT_TIMEOUT_MS) || 30_000;

// Until config.json says otherwise: enough concurrency to be worth watching, few enough
// processes to be harmless
const DEFAULT_CONFIG = { timeout: 3, maxConcurrency: 5, triggers: [] };

// ── Logging and metrics ───────────────────────────────────────────────────────────────────

// Lines from an environment carry its id, so the host files them as that environment's
// stream; the manager's own lines are bare
const environmentLine = (id, line) => console.log(`gg:env ${id} ${line}`);

// Embedded Metric Format: the shape CloudWatch extracts metrics from in a log line
function putMetric(name, value, unit, dimensions = {}) {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'glass-garden',
            Dimensions: [Object.keys(dimensions)],
            Metrics: [{ Name: name, Unit: unit }],
          },
        ],
      },
      ...dimensions,
      [name]: value,
    }),
  );
}

// ── Config ────────────────────────────────────────────────────────────────────────────────

let config = DEFAULT_CONFIG;

// Says a message only while it is new, so a failure that repeats every second or every poll
// is said once. Called with nothing it forgets, so the next failure is said again
function complainer() {
  let last;
  return (message) => {
    if (message && message !== last) console.error(message);
    last = message;
  };
}

const complainAboutConfig = complainer();

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
  // Absent is no triggers, which is what a function with no queue pointing at it has
  const { timeout, maxConcurrency, triggers = [] } = parsed ?? {};
  if (!(timeout > 0)) throw new Error(`config.json has no positive timeout: ${contents}`);
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error(`config.json has no positive maxConcurrency: ${contents}`);
  }
  // A queue delivers batches; a bucket's notifications arrive through a queue of their own
  const valid = (trigger) =>
    trigger &&
    typeof trigger.queueUrl === 'string' &&
    typeof trigger.queueName === 'string' &&
    ['sqs', 's3'].includes(trigger.source);
  if (!Array.isArray(triggers) || !triggers.every(valid)) {
    throw new Error(`config.json triggers are not a list of queue or bucket sources: ${contents}`);
  }
  return { timeout, maxConcurrency, triggers };
}

// Re-read on a timer rather than at spawn, so a change on the canvas — a raised cap, an
// added trigger — takes effect within a second and without relaunching the manager. The
// last good config stands if a read fails
async function refreshConfig() {
  try {
    config = await readConfig();
    complainAboutConfig();
  } catch (error) {
    complainAboutConfig(error.message);
  }
  reconcilePollers();
}

// ── Execution environments ────────────────────────────────────────────────────────────────

const environments = new Map();
const countEnvironments = (test) => [...environments.values()].filter(test).length;
// Invocations waiting for an environment, oldest first
const pending = [];
// Invocations handed to an environment, by request id
const inFlight = new Map();

let concurrencyBeat;

// A level rather than a tally, so the chart reads as what is running right now. A period
// with no samples is a gap rather than a zero, and an invocation outlives several, so the
// level keeps reporting itself while there is work and falls silent when there is none
function reportConcurrency() {
  const busy = countEnvironments((env) => env.invocation);
  putMetric('concurrent executions', busy, 'Count');
  if (busy > 0 && !concurrencyBeat) {
    concurrencyBeat = setInterval(reportConcurrency, METRIC_PERIOD_MS);
  } else if (busy === 0 && concurrencyBeat) {
    clearInterval(concurrencyBeat);
    concurrencyBeat = undefined;
  }
}

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
    spawnedAt: Date.now(),
    // Set when the environment first asks for work: its init is over
    readyAt: undefined,
    // The parked /next response, present exactly while the environment is idle
    waiting: undefined,
    invocation: undefined,
    invocations: 0,
    idleTimer: undefined,
    initTimer: setTimeout(() => reap(env, 'never asked for work'), INIT_TIMEOUT_MS),
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
    clearTimeout(env.initTimer);
    clearTimeout(env.idleTimer);
    if (!environments.delete(id)) return;
    console.log(`gg:env-exit ${id}`);
    if (!env.readyAt) {
      failStartup(env, {
        errorType: 'Runtime.InitError',
        errorMessage: 'The execution environment stopped before it asked for an invocation',
      });
    }
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

// An environment that dies before it ever asks for work means the function cannot start, so
// the invocation that spawned it fails with the reason instead of waiting on a respawn loop
function failStartup(env, error) {
  if (env.startupFailed) return;
  env.startupFailed = true;
  const invocation = pending.shift();
  if (invocation) invocation.resolve({ error });
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
  clearTimeout(env.idleTimer);
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
  if (env.invocations === 1) putMetric('cold starts', 1, 'Count', { environment: env.id });
  reportConcurrency();
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
  const duration = Date.now() - invocation.startedAt;
  // Lambda's own per-invocation summary, and the init time only on the invocation that
  // paid for the environment
  const report = [`REPORT RequestId: ${invocation.id}`, `Duration: ${duration} ms`];
  if (env.invocations === 1) report.push(`Init Duration: ${env.readyAt - env.spawnedAt} ms`);
  environmentLine(env.id, `END RequestId: ${invocation.id}`);
  environmentLine(env.id, report.join('\t'));
  const dimensions = { environment: env.id };
  putMetric('invocations', 1, 'Count', dimensions);
  putMetric('duration', duration, 'Milliseconds', dimensions);
  if (outcome.error) putMetric('errors', 1, 'Count', dimensions);
  reportConcurrency();
  invocation.resolve(outcome);
}

// An environment that is idle or on its way can take one more invocation; a busy one is
// spoken for, and past the cap there is nothing left to start
function capacity() {
  const coming = countEnvironments((env) => env.waiting || !env.readyAt);
  return coming + config.maxConcurrency - environments.size;
}

// Invocations that could start right now without a refusal
const free = () => capacity() - pending.length;

// One invocation, resolved with { result } or { error: { errorType, errorMessage } }. Lambda
// refuses a synchronous invocation it has no concurrency for rather than queueing it, so a
// caller learns the cap is the reason instead of waiting on it
function invoke(event) {
  return new Promise((resolve) => {
    if (free() < 1) {
      console.error(
        `Refused an invocation: all ${config.maxConcurrency} execution environments are busy`,
      );
      putMetric('throttles', 1, 'Count');
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
    clearTimeout(env.initTimer);
    env.readyAt ??= Date.now();
    env.waiting = res;
    // The environment went away mid-wait: not idle any more, and not to be handed work
    req.on('close', () => {
      if (env.waiting === res) env.waiting = undefined;
    });
    // Lambda's scale to zero: an environment nothing needs stops, and the next request
    // pays for a new one
    env.idleTimer = setTimeout(() => reap(env, `idle for ${IDLE_MS / 1000} s`), IDLE_MS);
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
    failStartup(env, error);
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

// ── Trigger queues ────────────────────────────────────────────────────────────────────────

// SigV4's shape without a signature: the region routes and enforces on the credential scope
// and never verifies one
const AUTHORIZATION = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/20260101/us-east-1/sqs/aws4_request, SignedHeaders=host, Signature=glass-garden`;

// hand-written SQS client to greatly reduce provisioning time of lambda nodes
function sqs(action, payload, signal) {
  return new Promise((resolve, reject) => {
    const url = new URL(ENDPOINT);
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: '/',
        method: 'POST',
        headers: {
          'content-type': 'application/x-amz-json-1.0',
          'content-length': Buffer.byteLength(body),
          'x-amz-target': `AmazonSQS.${action}`,
          authorization: AUTHORIZATION,
        },
        timeout: RECEIVE_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 400) return reject(new Error(awsErrorMessage(text, res.statusCode)));
          try {
            resolve(text ? JSON.parse(text) : {});
          } catch {
            reject(new Error(`the region answered ${action} with something other than JSON`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`${action} timed out`)));
    req.on('error', reject);
    signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    req.end(body);
  });
}

// AWS errors carry their message under one of two keys depending on the protocol
function awsErrorMessage(text, status) {
  try {
    const parsed = JSON.parse(text);
    const message = parsed.message ?? parsed.Message;
    if (typeof message === 'string') return message;
  } catch {
    // not JSON
  }
  return `HTTP ${status}`;
}

// The record shape Lambda hands a function for each SQS message
const toRecord = (message, queueName) => ({
  messageId: message.MessageId,
  receiptHandle: message.ReceiptHandle,
  body: message.Body,
  attributes: message.Attributes ?? {},
  messageAttributes: {},
  md5OfBody: message.MD5OfBody,
  eventSource: 'aws:sqs',
  eventSourceARN: `arn:aws:sqs:us-east-1:000000000000:${queueName}`,
  awsRegion: 'us-east-1',
});

const messageCount = (n) => `${n} message${n === 1 ? '' : 's'}`;

// What a trigger is called in the log: a bucket's queue is hidden, so it is not named
const describe = (trigger) =>
  trigger.source === 's3' ? 'bucket notifications' : `messages from "${trigger.queueName}"`;

const failure = (error) =>
  error.errorType === THROTTLED
    ? 'found no free execution environment'
    : `failed (${error.errorMessage ?? 'unknown error'})`;

// A queue's batch is one invocation, deleted whole once the handler returns. On failure
// nothing is deleted and the batch returns after the visibility timeout, which is Lambda's rule
async function deliverBatch({ queueName }, messages, remove) {
  putMetric('batches', 1, 'Count', { queue: queueName });
  const outcome = await invoke({ Records: messages.map((m) => toRecord(m, queueName)) });
  if (!outcome.error) return remove(messages);
  console.error(
    `A batch of ${messageCount(messages.length)} from "${queueName}" ${failure(outcome.error)}, so it returns to the queue after its visibility timeout`,
  );
}

// A bucket's events are one invocation each, run together as Lambda runs asynchronous
// invocations, and each is deleted the moment it succeeds: a failed or throttled one returns
// after the visibility timeout, which stands in for Lambda's retries. The test event S3 sends
// when a bucket is configured goes to queues, never to functions, so it is dropped
async function deliverNotifications(_trigger, messages, remove) {
  await Promise.all(
    messages.map(async (message) => {
      let event;
      try {
        event = JSON.parse(message.Body);
      } catch {
        event = undefined;
      }
      const record = event?.Records?.[0];
      if (!record) return remove([message]);
      const bucket = record.s3?.bucket?.name ?? '';
      putMetric('notifications', 1, 'Count', { bucket });
      const outcome = await invoke(event);
      if (outcome.error) {
        console.error(
          `The notification for ${bucket}/${record.s3?.object?.key} ${failure(outcome.error)}, so it is delivered again after its visibility timeout`,
        );
        return;
      }
      // Each on its own, as soon as it is done: one that waited for the rest of the batch
      // would be delivered again if this process died meanwhile
      await remove([message]);
    }),
  );
}

// The event source mapping for one trigger: long-poll, hand the messages to the delivery its
// source calls for, and let it delete what it finishes. A read failure is said once and retried
async function poll(trigger, signal) {
  const { queueUrl, source } = trigger;
  const deliver = source === 's3' ? deliverNotifications : deliverBatch;
  const complain = complainer();
  // Resolves early on abort rather than rejecting: the loop checks the signal itself
  const pause = (ms) => sleep(ms, undefined, { signal }).catch(() => {});
  const remove = async (messages) => {
    if (signal.aborted) return;
    try {
      await sqs(
        'DeleteMessageBatch',
        {
          QueueUrl: queueUrl,
          Entries: messages.map((m, i) => ({ Id: String(i), ReceiptHandle: m.ReceiptHandle })),
        },
        signal,
      );
    } catch (error) {
      if (signal.aborted) return;
      complain(`Could not delete ${messageCount(messages.length)} of ${describe(trigger)}: ${error.message}`);
    }
  };
  while (!signal.aborted) {
    // An event source mapping only pulls what it can run now, rather than receiving work it
    // would have to throttle and hand back for a visibility timeout. A batch is one
    // invocation however many messages it holds; notifications are one each
    while (!signal.aborted && free() < 1) await pause(SLOT_WAIT_MS);
    if (signal.aborted) return;
    let messages;
    try {
      const received = await sqs(
        'ReceiveMessage',
        {
          QueueUrl: queueUrl,
          MaxNumberOfMessages: source === 's3' ? Math.min(BATCH_SIZE, free()) : BATCH_SIZE,
          WaitTimeSeconds: WAIT_SECONDS,
          AttributeNames: ['All'],
        },
        signal,
      );
      messages = Array.isArray(received.Messages) ? received.Messages : [];
    } catch (error) {
      if (signal.aborted) return;
      complain(`Could not read ${describe(trigger)}: ${error.message}`);
      await pause(POLL_RETRY_MS);
      continue;
    }
    complain();
    if (messages.length === 0) continue;

    await deliver(trigger, messages, remove);
  }
}

const pollers = new Map();

function reconcilePollers() {
  const wanted = new Map(config.triggers.map((trigger) => [trigger.queueUrl, trigger]));
  for (const [queueUrl, { trigger, controller }] of pollers) {
    if (wanted.has(queueUrl)) continue;
    controller.abort();
    pollers.delete(queueUrl);
    console.log(`Stopped polling for ${describe(trigger)}`);
  }
  for (const [queueUrl, trigger] of wanted) {
    if (pollers.has(queueUrl)) continue;
    const controller = new AbortController();
    pollers.set(queueUrl, { trigger, controller });
    console.log(`Polling for ${describe(trigger)}`);
    poll(trigger, controller.signal).catch((error) =>
      console.error(`Polling for ${describe(trigger)} stopped: ${error.stack ?? error.message}`),
    );
  }
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
