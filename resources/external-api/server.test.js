// The harness under real Node: the same code the VM runs, minus the VM
import { afterEach, describe, expect, it } from 'vitest';
import { EVENT_PREFIX } from '../aws-region/lib.js';
import net from 'node:net';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('./server.js', import.meta.url));
const CALLER = fileURLToPath(new URL('./caller.js', import.meta.url));
const PACKAGE = fileURLToPath(new URL('./package.json', import.meta.url));

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

// Laid down side by side, as the canvas does
async function externalApi(code) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'external-api-'));
  await copyFile(SERVER, path.join(cwd, 'server.js'));
  await copyFile(CALLER, path.join(cwd, 'caller.js'));
  await copyFile(PACKAGE, path.join(cwd, 'package.json'));
  await writeFile(path.join(cwd, 'api.mjs'), code);
  const port = await freePort();
  const child = spawn('node', ['server.js'], { cwd, env: { ...process.env, PORT: String(port) } });

  const stdout = [];
  const stderr = [];
  const metrics = [];
  const hops = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (line.startsWith(EVENT_PREFIX)) return hops.push(JSON.parse(line.slice(EVENT_PREFIX.length)));
    if (!line.startsWith('{')) return stdout.push(line);
    const parsed = JSON.parse(line);
    const [{ Metrics }] = parsed._aws.CloudWatchMetrics;
    for (const { Name, Unit } of Metrics) {
      metrics.push({ name: Name, unit: Unit, value: parsed[Name], status: parsed.status });
    }
  });
  readline.createInterface({ input: child.stderr }).on('line', (line) => stderr.push(line));
  const exited = new Promise((resolve) => child.on('exit', resolve));

  cleanups.push(async () => {
    child.kill();
    await exited;
    await rm(cwd, { recursive: true, force: true });
  });

  const listening = () => stdout.some((line) => line.includes('running'));
  const ready = Promise.race([
    waitUntil(listening, () => `Never listened\n${stderr.join('\n')}`),
    exited.then((code) => ({ code }))
  ]);
  return {
    stderr,
    metrics,
    hops,
    exited,
    ready,
    call: (url, init) => fetch(`http://localhost:${port}${url}`, init),
    // Flattened across seconds
    readings: (name) => metrics.filter((m) => m.name === name).flatMap((m) => [m.value].flat()),
    waitFor: (find, what) => waitUntil(find, () => `${what}; saw ${JSON.stringify(metrics)}`)
  };
}

const ECHO = `
export async function handle(request) {
  return Response.json({
    method: request.method,
    path: new URL(request.url).pathname,
    body: request.method === 'GET' ? null : await request.json()
  });
}
`;

describe('answering', () => {
  it("answers with the author's Response, addressed without the caller's prefix", async () => {
    const api = await externalApi(ECHO);
    await api.ready;
    const response = await api.call('/from/node-7/charges', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payment: 3 })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: 'POST',
      path: '/charges',
      body: { payment: 3 }
    });
  });

  it('draws each call from the node whose address it arrived at', async () => {
    const api = await externalApi(ECHO);
    await api.ready;
    await api.call('/from/node-7/charges');
    await api.call('/from/node-9');
    expect(api.hops.map((hop) => hop.from)).toEqual([{ node: 'node-7' }, { node: 'node-9' }]);
  });

  // A shell's curl, say, has no edge to be drawn on
  it('answers a call with no caller without drawing it', async () => {
    const api = await externalApi(ECHO);
    await api.ready;
    const response = await api.call('/charges');
    expect(await response.json()).toMatchObject({ path: '/charges' });
    expect(api.hops).toEqual([]);
  });

  it('answers 500 and logs why when the handler throws', async () => {
    const api = await externalApi(`export function handle() { throw new Error('card declined'); }`);
    await api.ready;
    const response = await api.call('/from/a/charges');
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('card declined');
    expect(api.stderr.join('\n')).toContain('card declined');
  });

  it('answers 500 when the handler returns something other than a Response', async () => {
    const api = await externalApi(`export function handle() { return { ok: true }; }`);
    await api.ready;
    const response = await api.call('/from/a/charges');
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('must return a Response');
  });
});

describe('counting', () => {
  it('counts requests by status and each 5xx as an error', async () => {
    const api = await externalApi(`
      export function handle(request) {
        const failing = new URL(request.url).pathname === '/fail';
        return new Response('', { status: failing ? 503 : 200 });
      }
    `);
    await api.ready;
    await api.call('/from/a/ok');
    await api.call('/from/a/ok');
    await api.call('/from/a/fail');
    // Less the boot zero
    const outcomes = () =>
      api.metrics.filter((m) => m.name === 'errors' && Array.isArray(m.value)).flatMap((m) => m.value);
    await api.waitFor(() => outcomes().length >= 3, 'Never counted three outcomes');
    expect(outcomes().sort()).toEqual([0, 0, 1]);
    const requests = api.metrics.filter((m) => m.name === 'requests' && m.status !== undefined);
    expect(requests.map((m) => [m.status, [m.value].flat().length]).sort()).toEqual([
      ['200', 2],
      ['503', 1]
    ]);
  });

  it("reports the author's declared counts as zero before anything happens", async () => {
    const api = await externalApi(`
      export const metrics = { repeats: 'Count' };
      export function handle() { return new Response(''); }
    `);
    await api.ready;
    await api.waitFor(() => api.readings('repeats').length >= 1, 'Never reported repeats');
    expect(api.readings('repeats').every((value) => value === 0)).toBe(true);
  });

  it("reports what the author's code measured", async () => {
    const api = await externalApi(`
      export const metrics = { repeats: 'Count' };
      export function handle(request, { metric }) {
        metric('repeats', 1);
        metric('charge size', 2500, 'None');
        return new Response('');
      }
    `);
    await api.ready;
    await api.call('/from/a/charges');
    await api.waitFor(() => api.readings('repeats').includes(1), 'Never reported the repeat');
    expect(api.readings('charge size')).toEqual([2500]);
    expect(api.metrics.find((m) => m.name === 'charge size').unit).toBe('None');
  });
});

describe('starting', () => {
  it('refuses to start without a handle, and says so', async () => {
    const api = await externalApi(`export const nothing = 1;`);
    expect(await api.ready).toEqual({ code: 1 });
    expect(api.stderr.join('\n')).toContain('must export a function named handle');
  });

  it("refuses to start when the author's code does not load, and says why", async () => {
    const api = await externalApi(`export function handle( {`);
    expect(await api.ready).toEqual({ code: 1 });
    expect(api.stderr.join('\n')).toContain("The API's code did not load");
  });
});
