// The manager under real Node: the same code the VM runs, minus the VM
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANAGER = fileURLToPath(new URL('./manager.mjs', import.meta.url));
// What a test's manager runs with unless it says otherwise
const DEFAULT_MAX_CONCURRENCY = 5;
const DEFAULT_CONFIG = { timeout: 3, maxConcurrency: DEFAULT_MAX_CONCURRENCY, triggers: [] };

const ECHO_HANDLER = `
export async function handler(event, context) {
  if (event.Records) {
    for (const record of event.Records) {
      if (record.s3) console.log('object ' + record.s3.object.key);
      else console.log('record ' + record.body);
    }
    // Long enough that two notifications delivered together overlap
    if (event.Records[0].s3) await new Promise((resolve) => setTimeout(resolve, 300));
    // The same, for batches: long enough that a second one overlaps the first
    if (event.Records.some((record) => record.body?.startsWith('slow'))) await new Promise((resolve) => setTimeout(resolve, 300));
    if (event.Records.some((record) => record.body === 'bad')) throw new Error('bad batch');
    if (event.Records.some((record) => record.s3?.object.key === 'bad.txt')) throw new Error('bad object');
    return;
  }
  const wait = Number(event.queryStringParameters?.wait ?? 0);
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  if (event.rawPath === '/throw') throw new TypeError('handler failed');
  if (event.rawPath === '/text') return 'plain text';
  return { statusCode: 201, headers: { 'x-echo': 'yes' }, body: { path: event.rawPath, remaining: context.getRemainingTimeInMillis() } };
}
`;

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CONFIG_POLL_MS = 100;
// Long enough for the manager to have re-read config.json more than once
const CONFIG_POLLS_MS = CONFIG_POLL_MS * 3;

async function waitUntil(find, what, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = find();
    if (found) return found;
    await sleep(20);
  }
  throw new Error(what());
}

const waitForCall = (region, action) =>
  waitUntil(
    () => region.calls.find((c) => c.action === action),
    () => `The region never saw ${action}`
  );

// A region that answers SQS calls from a script the test writes, recording what it saw
function fakeRegion(answer) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const action = req.headers['x-amz-target']?.replace('AmazonSQS.', '');
    const payload = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    calls.push({ action, payload, authorization: req.headers.authorization });
    const reply = await answer(action, payload);
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/x-amz-json-1.0' });
    res.end(JSON.stringify(reply.body ?? {}));
  });
  return {
    calls,
    listen: () => new Promise((resolve) => server.listen(0, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

const running = [];

async function startManager({
  config,
  region,
  handler = ECHO_HANDLER,
  handlerFile = 'index.mjs',
  idleMs = 60_000,
  initTimeoutMs = 30_000
} = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'function-manager-'));
  await writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(dir, handlerFile), handler);
  await writeFile(path.join(dir, 'config.json'), JSON.stringify({ ...DEFAULT_CONFIG, ...config }));
  const port = await freePort();
  const regionPort = region ? await region.listen() : 1;
  const child = spawn('node', [MANAGER], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: String(port),
      AWS_ENDPOINT_URL: `http://localhost:${regionPort}`,
      AWS_ACCESS_KEY_ID: 'ggtest',
      AWS_LAMBDA_FUNCTION_NAME: 'tested',
      GG_CONFIG_POLL_MS: String(CONFIG_POLL_MS),
      GG_IDLE_MS: String(idleMs),
      GG_INIT_TIMEOUT_MS: String(initTimeoutMs)
    }
  });
  const lines = [];
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream }).on('line', (line) => lines.push(line));
  }
  const manager = {
    port,
    dir,
    lines,
    region,
    writeConfig: (value) =>
      writeFile(path.join(dir, 'config.json'), JSON.stringify({ ...DEFAULT_CONFIG, ...value })),
    url: (route = '/') => `http://localhost:${port}${route}`,
    // Waits for a log line, which is also how the tests read what the environments printed
    waitFor: (test, timeout = 5000) =>
      waitUntil(
        () => lines.find(test),
        () => `No line matched within ${timeout} ms:\n${lines.join('\n')}`,
        timeout
      ),
    stop: async () => {
      child.kill();
      await region?.close();
      await rm(dir, { recursive: true, force: true });
    }
  };
  running.push(manager);
  await manager.waitFor((line) => line.startsWith('Function ready'));
  return manager;
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((manager) => manager.stop()));
});

// The EMF lines the manager printed for one metric name
const metrics = (lines, name) =>
  lines
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .filter((line) => line._aws?.CloudWatchMetrics?.[0]?.Metrics?.[0]?.Name === name);

const environmentIds = (lines) =>
  [...new Set(lines.filter((l) => l.startsWith('gg:env ')).map((l) => l.split(' ')[1]))];

describe('function URL', () => {
  it('starts an environment on the first request and reuses it for the next', async () => {
    const manager = await startManager();
    const first = await fetch(manager.url('/one'));
    expect(first.status).toBe(201);
    expect(first.headers.get('x-echo')).toBe('yes');
    const body = await first.json();
    expect(body.path).toBe('/one');
    // The handler is told how long it has left, from the deadline the manager sent
    expect(body.remaining).toBeGreaterThan(0);
    expect(body.remaining).toBeLessThanOrEqual(3000);
    await manager.waitFor((l) => /END RequestId/.test(l));

    await manager.waitFor((l) => /REPORT RequestId: .*Init Duration/.test(l));

    const second = await fetch(manager.url('/two'));
    expect(await second.json()).toMatchObject({ path: '/two' });
    expect(manager.lines.filter((l) => /START RequestId/.test(l))).toHaveLength(2);
    expect(environmentIds(manager.lines)).toHaveLength(1);
    // The second invocation is warm, so it reports no init time and mints no cold start
    await manager.waitFor((l) => /REPORT RequestId/.test(l) && !/Init Duration/.test(l));
    expect(metrics(manager.lines, 'cold starts')).toHaveLength(1);
    expect(metrics(manager.lines, 'invocations')).toHaveLength(2);
  });

  it('takes the handler from index.js when there is no index.mjs', async () => {
    const manager = await startManager({ handlerFile: 'index.js' });
    const response = await fetch(manager.url('/text'));
    expect(await response.text()).toBe('plain text');
  });

  it('sends a string result as text', async () => {
    const manager = await startManager();
    const response = await fetch(manager.url('/text'));
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(await response.text()).toBe('plain text');
  });

  it('answers a thrown handler with a 502 naming the error', async () => {
    const manager = await startManager();
    const response = await fetch(manager.url('/throw'));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      errorType: 'TypeError',
      errorMessage: 'handler failed'
    });
    await manager.waitFor((l) => /Invoke Error/.test(l));
    await waitUntil(
      () => metrics(manager.lines, 'errors').length === 1,
      () => 'The failed invocation reported no error metric'
    );
  });

  it('refuses an invocation it has no concurrency for, as Lambda does', async () => {
    const manager = await startManager();
    const responses = await Promise.all(
      Array.from({ length: DEFAULT_MAX_CONCURRENCY + 1 }, (_, i) =>
        fetch(manager.url(`/${i}?wait=400`))
      )
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([...Array(DEFAULT_MAX_CONCURRENCY).fill(201), 429]);
    const refused = responses.find((r) => r.status === 429);
    expect(refused.headers.get('x-amzn-errortype')).toBe('TooManyRequestsException');
    expect(await refused.json()).toEqual({ message: 'Rate exceeded' });
    expect(metrics(manager.lines, 'throttles')).toHaveLength(1);
    expect(environmentIds(manager.lines)).toHaveLength(DEFAULT_MAX_CONCURRENCY);
  });

  it('keeps reporting concurrency while an invocation runs', async () => {
    const manager = await startManager();
    await fetch(manager.url('/slow?wait=2500'));
    const busy = metrics(manager.lines, 'concurrent executions').filter(
      (line) => line['concurrent executions'] === 1
    );
    // One at the start and one per second it kept running, rather than a single sample
    expect(busy.length).toBeGreaterThanOrEqual(3);
    expect(metrics(manager.lines, 'concurrent executions').at(-1)).toMatchObject({
      'concurrent executions': 0
    });
  });

  it('takes its concurrency from the config file', async () => {
    const manager = await startManager({ config: { timeout: 3, maxConcurrency: 2 } });
    const statuses = await Promise.all(
      [1, 2, 3].map((i) => fetch(manager.url(`/${i}?wait=400`)).then((r) => r.status))
    );
    expect(statuses.sort()).toEqual([201, 201, 429]);
    expect(environmentIds(manager.lines)).toHaveLength(2);
  });

  it('follows a change to the config file without a restart', async () => {
    const manager = await startManager({ config: { timeout: 3, maxConcurrency: 1 } });
    const refused = await Promise.all(
      [1, 2].map((i) => fetch(manager.url(`/${i}?wait=300`)).then((r) => r.status))
    );
    expect(refused.sort()).toEqual([201, 429]);

    await manager.writeConfig({ timeout: 3, maxConcurrency: 3 });
    await sleep(CONFIG_POLLS_MS);
    const allowed = await Promise.all(
      [1, 2, 3].map((i) => fetch(manager.url(`/${i}?wait=300`)).then((r) => r.status))
    );
    expect(allowed).toEqual([201, 201, 201]);
  });

  it('says once that the config file cannot be read, and keeps the last good one', async () => {
    const manager = await startManager({ config: { timeout: 3, maxConcurrency: 2 } });
    await writeFile(path.join(manager.dir, 'config.json'), '{"timeout": 3');
    await manager.waitFor((l) => /config\.json is not valid JSON/.test(l));
    await sleep(CONFIG_POLLS_MS);
    expect(manager.lines.filter((l) => /config\.json is not valid JSON/.test(l))).toHaveLength(1);
    const statuses = await Promise.all(
      [1, 2, 3].map((i) => fetch(manager.url(`/${i}?wait=400`)).then((r) => r.status))
    );
    expect(statuses.sort()).toEqual([201, 201, 429]);
  });

  it('fails an invocation past its timeout with Lambda’s message and replaces its environment', async () => {
    const manager = await startManager({ config: { timeout: 0.5, maxConcurrency: 5 } });
    const response = await fetch(manager.url('/slow?wait=2000'));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      errorType: 'Sandbox.Timedout',
      errorMessage: 'Task timed out after 0.50 seconds'
    });
    await manager.waitFor((l) => l.startsWith('gg:env-exit '));
    const [first] = environmentIds(manager.lines);

    await fetch(manager.url('/again'));
    expect(environmentIds(manager.lines)).toHaveLength(2);
    expect(environmentIds(manager.lines)[0]).toBe(first);
  });

  it('reaps an environment left idle, so the function falls back to zero', async () => {
    const manager = await startManager({ idleMs: 300 });
    await fetch(manager.url('/'));
    await manager.waitFor((l) => /idle for 0.3 s/.test(l), 3000);
    await manager.waitFor((l) => l.startsWith('gg:env-exit '));

    await fetch(manager.url('/again'));
    expect(environmentIds(manager.lines)).toHaveLength(2);
  });

  it('reaps an environment that never asks for work', async () => {
    const manager = await startManager({
      // Alive but never loading: the timer keeps the event loop busy, so node does not
      // notice the unsettled await and exit on its own
      handler: 'setInterval(() => {}, 1000); await new Promise(() => {});',
      initTimeoutMs: 300
    });
    const response = await fetch(manager.url('/'));
    expect(response.status).toBe(502);
    await manager.waitFor((l) => /never asked for work/.test(l));
  });

  it('fails the invocation when the handler cannot be loaded', async () => {
    const manager = await startManager({ handler: 'export const notHandler = 1;' });
    const response = await fetch(manager.url('/'));
    expect(response.status).toBe(502);
    expect((await response.json()).errorMessage).toMatch(/does not export a function named "handler"/);
    await manager.waitFor((l) => /failed to initialize/.test(l));
  });
});

describe('trigger queues', () => {
  const queueUrl = 'http://localhost:1/000000000000/orders';
  const trigger = { source: 'sqs', queueUrl, queueName: 'orders' };
  const message = (body) => ({ MessageId: body, ReceiptHandle: `rh-${body}`, Body: body });
  const triggered = { timeout: 3, maxConcurrency: 5, triggers: [trigger] };

  // Serves one batch and then nothing, as a queue that has been drained answers
  const queueServing = (...bodies) => {
    let served = false;
    return fakeRegion(async (action) => {
      if (action === 'ReceiveMessage' && !served) {
        served = true;
        return { body: { Messages: bodies.map(message) } };
      }
      await sleep(100);
      return {};
    });
  };

  // One batch per receive while any remain, as a queue with a backlog answers
  const queueBacklog = (...batches) => {
    const waiting = [...batches];
    return fakeRegion(async (action) => {
      if (action === 'ReceiveMessage' && waiting.length > 0) {
        return { body: { Messages: waiting.shift().map(message) } };
      }
      await sleep(100);
      return {};
    });
  };

  it('delivers a batch as Records and deletes it once the handler returns', async () => {
    const region = queueServing('one', 'two');
    const manager = await startManager({ config: triggered, region });
    await manager.waitFor((l) => /record two/.test(l));
    const deletion = await waitForCall(region, 'DeleteMessageBatch');
    expect(deletion.payload.Entries.map((e) => e.ReceiptHandle)).toEqual(['rh-one', 'rh-two']);
    expect(deletion.authorization).toMatch(/Credential=ggtest\/\d{8}\/us-east-1\/sqs\/aws4_request/);
    const receive = region.calls.find((c) => c.action === 'ReceiveMessage');
    expect(receive.payload).toMatchObject({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 });
    await manager.waitFor((l) => /"batches"/.test(l));
  });

  it('runs batches from one queue together, up to the cap', async () => {
    const region = queueBacklog(['slow-a'], ['slow-b'], ['slow-c']);
    const manager = await startManager({ config: { ...triggered, maxConcurrency: 3 }, region });
    await manager.waitFor((l) => /record slow-c/.test(l));
    expect(environmentIds(manager.lines)).toHaveLength(3);
  });

  it('holds a queue to one batch at a time when the cap is one', async () => {
    const region = queueBacklog(['slow-a'], ['slow-b']);
    const manager = await startManager({ config: { ...triggered, maxConcurrency: 1 }, region });
    await manager.waitFor((l) => /record slow-b/.test(l));
    expect(environmentIds(manager.lines)).toHaveLength(1);
    expect(manager.lines.filter((l) => /no free execution environment/.test(l))).toHaveLength(0);
  });

  it('leaves a failed batch on the queue', async () => {
    const region = queueServing('bad');
    const manager = await startManager({ config: triggered, region });
    await manager.waitFor((l) => /returns to the queue after its visibility timeout/.test(l));
    await sleep(200);
    expect(region.calls.some((c) => c.action === 'DeleteMessageBatch')).toBe(false);
  });

  it('says once when the queue refuses it, and keeps trying', async () => {
    const region = fakeRegion(async () => ({
      status: 403,
      body: { __type: 'AccessDenied', message: 'not connected to the queue "orders"' }
    }));
    const manager = await startManager({ config: triggered, region });
    await manager.waitFor((l) => /Could not read messages from "orders": not connected/.test(l));
    await sleep(300);
    expect(manager.lines.filter((l) => /Could not read/.test(l))).toHaveLength(1);
  });

  it('starts and stops polling as the config file changes, without a restart', async () => {
    const region = fakeRegion(async () => {
      await sleep(50);
      return {};
    });
    const manager = await startManager({ region });
    await sleep(300);
    expect(region.calls).toHaveLength(0);

    await manager.writeConfig(triggered);
    await manager.waitFor((l) => /Polling for messages from "orders"/.test(l));
    await waitForCall(region, 'ReceiveMessage');

    await manager.writeConfig({ ...triggered, triggers: [] });
    await manager.waitFor((l) => /Stopped polling for messages from "orders"/.test(l));
    const seen = region.calls.length;
    await sleep(400);
    expect(region.calls.length).toBe(seen);
  });
});

describe('bucket notifications', () => {
  const queueUrl = 'http://localhost:1/000000000000/gg-notifications-f1';
  const trigger = { source: 's3', queueUrl, queueName: 'gg-notifications-f1' };
  const triggered = { timeout: 3, maxConcurrency: 5, triggers: [trigger] };
  // The body S3 puts on the queue for one object, as ministack builds it
  const notification = (key) =>
    JSON.stringify({
      Records: [
        {
          eventSource: 'aws:s3',
          eventName: 'ObjectCreated:Put',
          s3: { bucket: { name: 'uploads' }, object: { key, size: 3 } }
        }
      ]
    });
  const testEvent = JSON.stringify({ Service: 'Amazon S3', Event: 's3:TestEvent' });
  const message = (id, body) => ({ MessageId: id, ReceiptHandle: `rh-${id}`, Body: body });

  // Serves the given messages, as many per receive as asked for, then nothing
  const queueServing = (...messages) => {
    const waiting = [...messages];
    return fakeRegion(async (action, payload) => {
      if (action === 'ReceiveMessage' && waiting.length > 0) {
        return { body: { Messages: waiting.splice(0, payload.MaxNumberOfMessages) } };
      }
      await sleep(100);
      return {};
    });
  };

  it('invokes the handler with the S3 event and deletes the notification', async () => {
    const region = queueServing(message('a', notification('photo.jpg')));
    const manager = await startManager({ config: triggered, region });
    await manager.waitFor((l) => /object photo.jpg/.test(l));
    const deletion = await waitForCall(region, 'DeleteMessageBatch');
    expect(deletion.payload.Entries.map((e) => e.ReceiptHandle)).toEqual(['rh-a']);
    expect(metrics(manager.lines, 'notifications')).toMatchObject([{ bucket: 'uploads' }]);
  });

  it('drops the test event S3 sends when a bucket is configured', async () => {
    const region = queueServing(message('t', testEvent));
    const manager = await startManager({ config: triggered, region });
    const deletion = await waitForCall(region, 'DeleteMessageBatch');
    expect(deletion.payload.Entries.map((e) => e.ReceiptHandle)).toEqual(['rh-t']);
    expect(manager.lines.filter((l) => /START RequestId/.test(l))).toHaveLength(0);
  });

  it('pulls only as many notifications as it can run, rather than throttling the rest', async () => {
    const region = queueServing(message('a', notification('a.txt')), message('b', notification('b.txt')));
    const manager = await startManager({ config: { ...triggered, maxConcurrency: 1 }, region });
    await manager.waitFor((l) => /object a.txt/.test(l));
    await manager.waitFor((l) => /object b.txt/.test(l));
    expect(manager.lines.filter((l) => /no free execution environment/.test(l))).toHaveLength(0);
    expect(environmentIds(manager.lines)).toHaveLength(1);
  });

  it('deletes each notification as it finishes, not once the whole receive is done', async () => {
    const region = queueServing(message('a', notification('a.txt')), message('b', notification('b.txt')));
    const manager = await startManager({ config: triggered, region });
    await waitUntil(
      () => region.calls.filter((c) => c.action === 'DeleteMessageBatch').length === 2,
      () => 'The two notifications were deleted together rather than one at a time'
    );
  });

  it('runs notifications together and deletes only the ones that succeeded', async () => {
    const region = queueServing(
      message('good', notification('fine.txt')),
      message('bad', notification('bad.txt'))
    );
    const manager = await startManager({ config: triggered, region });
    await manager.waitFor((l) => /delivered again after its visibility timeout/.test(l));
    const deletion = await waitForCall(region, 'DeleteMessageBatch');
    expect(deletion.payload.Entries.map((e) => e.ReceiptHandle)).toEqual(['rh-good']);
    // Both ran at once: two environments, not one reused
    expect(environmentIds(manager.lines)).toHaveLength(2);
  });
});
