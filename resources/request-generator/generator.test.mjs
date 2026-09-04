// The generator under real Node: the same code the VM runs, minus the VM
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATOR = fileURLToPath(new URL('./generator.js', import.meta.url));

const CONFIG_POLL_MS = 100;
// Long enough for the generator to have re-read config.json more than once
const CONFIG_POLLS_MS = CONFIG_POLL_MS * 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(find, what, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = find();
    if (found) return found;
    await sleep(20);
  }
  throw new Error(what());
}

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const cleanups = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

// A target that records what reaches it and answers however the test says. Answering
// `undefined` holds the request open for the rest of the test
function target(answer = () => ({})) {
  const requests = [];
  const held = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = {
      method: req.method,
      url: req.url,
      body: Buffer.concat(chunks).toString(),
      contentType: req.headers['content-type']
    };
    requests.push(request);
    const reply = answer(request);
    if (reply === undefined) return held.push(res);
    res.writeHead(reply.status ?? 200).end(reply.body ?? 'ok');
  });
  server.listen(0);
  cleanups.push(
    () =>
      new Promise((resolve) => {
        for (const res of held) res.destroy();
        server.closeAllConnections();
        server.close(resolve);
      })
  );
  return { port: server.address().port, requests };
}

const baseConfig = {
  method: 'GET',
  path: '/',
  body: '',
  requestsPerSecond: 50,
  maxInFlight: 50,
  target: null
};

async function generator(config) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'generator-'));
  const configPath = path.join(cwd, 'config.json');
  const write = (next) => writeFile(configPath, JSON.stringify({ ...baseConfig, ...next }));
  if (config !== undefined) await write(config);

  const child = spawn('node', [GENERATOR], {
    cwd,
    env: { ...process.env, GG_CONFIG_POLL_MS: String(CONFIG_POLL_MS) }
  });
  const stdout = [];
  const stderr = [];
  const metrics = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.startsWith('{')) return stdout.push(line);
    const parsed = JSON.parse(line);
    const [{ Metrics, Dimensions }] = parsed._aws.CloudWatchMetrics;
    for (const { Name } of Metrics) {
      metrics.push({ name: Name, value: parsed[Name], status: parsed.status, dimensions: Dimensions });
    }
  });
  readline.createInterface({ input: child.stderr }).on('line', (line) => stderr.push(line));
  const exited = new Promise((resolve) => child.on('exit', resolve));

  cleanups.push(async () => {
    child.kill();
    await exited;
    await rm(cwd, { recursive: true, force: true });
  });
  return {
    cwd,
    stdout,
    stderr,
    metrics,
    exited,
    write,
    // Readings of one metric, less the zero each count is announced with at boot
    of: (name) => metrics.filter((metric) => metric.name === name && metric.value !== 0),
    waitFor: (name, count = 1) =>
      waitUntil(
        () => metrics.filter((metric) => metric.name === name && metric.value !== 0).length >= count,
        () => `Never published ${count} ${name}; saw ${JSON.stringify(metrics)}\n${stderr.join('\n')}`
      )
  };
}

describe('sending', () => {
  it('sends the configured request at the configured rate', async () => {
    const app = target();
    const body = JSON.stringify({ hello: 'world' });
    await generator({
      method: 'POST',
      path: '/orders?x=1',
      body,
      requestsPerSecond: 40,
      target: app.port
    });
    await sleep(1000);
    // Timers run late, never early, so the count comes in under the rate
    expect(app.requests.length).toBeGreaterThan(20);
    expect(app.requests.length).toBeLessThanOrEqual(41);
    expect(app.requests[0]).toEqual({
      method: 'POST',
      url: '/orders?x=1',
      body,
      contentType: 'application/json'
    });
  });

  it('sends a body that is not JSON as plain text', async () => {
    const app = target();
    await generator({ method: 'PUT', body: 'plain words', target: app.port });
    await waitUntil(
      () => app.requests.length > 0,
      () => 'The target never heard from the generator'
    );
    expect(app.requests[0].contentType).toBe('text/plain');
  });

  it('follows a rewrite of the target without restarting', async () => {
    const first = target();
    const second = target();
    const g = await generator({ target: first.port });
    await sleep(300);
    expect(first.requests.length).toBeGreaterThan(0);
    expect(second.requests.length).toBe(0);

    await g.write({ target: second.port });
    await sleep(CONFIG_POLLS_MS);
    const before = first.requests.length;
    await sleep(300);
    expect(first.requests.length).toBe(before);
    expect(second.requests.length).toBeGreaterThan(0);
    expect(g.stdout).toEqual([
      `Sending GET / to :${first.port} at 50/s`,
      `Sending GET / to :${second.port} at 50/s`
    ]);
  });

  it('idles with nothing wired to it', async () => {
    const g = await generator({ target: null });
    await sleep(CONFIG_POLLS_MS);
    expect(g.stdout).toEqual(['Nothing to send to: nothing running is wired to this generator']);
    // Every count is named up front, at zero
    expect(g.metrics.map(({ name, value }) => [name, value])).toEqual([
      ['requests', 0],
      ['connection errors', 0],
      ['skipped requests', 0]
    ]);
    expect(g.stderr).toEqual([]);
  });

  it('exits when there is no config.json to start from', async () => {
    const g = await generator();
    expect(await g.exited).toBe(1);
    expect(g.stderr[0]).toMatch(/^Request generator failed: Error: Cannot read config\.json: ENOENT/);
  });

  it('keeps the last good config through a torn read, and says so once', async () => {
    const app = target();
    const g = await generator({ target: app.port });
    await waitUntil(
      () => app.requests.length > 0,
      () => 'The target never heard from the generator'
    );
    await writeFile(path.join(g.cwd, 'config.json'), '{"target": 1');
    await sleep(CONFIG_POLLS_MS);
    const before = app.requests.length;
    await sleep(200);
    expect(app.requests.length).toBeGreaterThan(before);
    expect(g.stderr).toEqual([
      expect.stringMatching(/^config\.json is not valid JSON \(.*\): \{"target": 1$/)
    ]);
  });
});

describe('metrics', () => {
  it('publishes a second of responses as one reading per status', async () => {
    let n = 0;
    const app = target(() => ({ status: n++ % 2 === 0 ? 200 : 404 }));
    const g = await generator({ target: app.port });
    await g.waitFor('requests', 2);
    const requests = g.of('requests');
    const times = g.of('response time');
    expect(requests.map((m) => m.status).sort()).toEqual(['200', '404']);
    for (const metric of [...requests, ...times]) {
      expect(metric.dimensions).toEqual([[], ['status']]);
      expect(Array.isArray(metric.value)).toBe(true);
    }
    // One entry per response in both, so a count and a time describe the same requests
    expect(requests[0].value.length).toBe(times[0].value.length);
    expect(requests[0].value.every((v) => v === 1)).toBe(true);
    expect(times[0].value.every((ms) => Number.isInteger(ms) && ms >= 0)).toBe(true);
  });

  it('counts connection errors and complains once', async () => {
    const port = await freePort();
    const g = await generator({ target: port });
    await g.waitFor('connection errors');
    await sleep(1000);
    const errors = g.of('connection errors');
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors[0].dimensions).toEqual([[]]);
    expect(g.stderr).toEqual([expect.stringMatching(new RegExp(`^:${port} unreachable: `))]);
  });

  it('skips requests at the in-flight cap and counts them', async () => {
    const app = target(() => undefined);
    const g = await generator({ maxInFlight: 3, target: app.port });
    await waitUntil(
      () => g.of('skipped requests').some(({ value }) => value > 0),
      () => 'Never skipped a request'
    );
    expect(app.requests.length).toBe(3);
    expect(g.of('response time')).toEqual([]);
    expect(g.stderr).toEqual([
      expect.stringMatching(/^3 requests in flight and no answers yet, so \d+ were skipped this second$/)
    ]);
  });
});
