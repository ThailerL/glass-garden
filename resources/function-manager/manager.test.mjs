// The manager under real Node: the same code the VM runs, minus the VM
import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANAGER = fileURLToPath(new URL('./manager.mjs', import.meta.url));
// What the manager falls back to with no config.json
const DEFAULT_MAX_CONCURRENCY = 5;

const ECHO_HANDLER = `
export async function handler(event, context) {
  const wait = Number(event.queryStringParameters?.wait ?? 0);
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  if (event.rawPath === '/throw') throw new TypeError('handler failed');
  if (event.rawPath === '/text') return 'plain text';
  return { statusCode: 201, headers: { 'x-echo': 'yes' }, body: { path: event.rawPath, id: context.awsRequestId } };
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

const running = [];

async function startManager({ config, handler = ECHO_HANDLER, handlerFile = 'index.mjs' } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'function-manager-'));
  await writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(dir, handlerFile), handler);
  if (config) await writeFile(path.join(dir, 'config.json'), JSON.stringify(config));
  const port = await freePort();
  const child = spawn('node', [MANAGER], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: String(port),
      AWS_LAMBDA_FUNCTION_NAME: 'tested',
      GG_CONFIG_POLL_MS: String(CONFIG_POLL_MS)
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
    writeConfig: (value) => writeFile(path.join(dir, 'config.json'), JSON.stringify(value)),
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

const environmentIds = (lines) =>
  [...new Set(lines.filter((l) => l.startsWith('gg:env ')).map((l) => l.split(' ')[1]))];

describe('function URL', () => {
  it('starts an environment on the first request and reuses it for the next', async () => {
    const manager = await startManager();
    const first = await fetch(manager.url('/one'));
    expect(first.status).toBe(201);
    expect(first.headers.get('x-echo')).toBe('yes');
    expect(await first.json()).toMatchObject({ path: '/one' });
    await manager.waitFor((l) => /END RequestId/.test(l));

    const second = await fetch(manager.url('/two'));
    expect(await second.json()).toMatchObject({ path: '/two' });
    expect(manager.lines.filter((l) => /START RequestId/.test(l))).toHaveLength(2);
    expect(environmentIds(manager.lines)).toHaveLength(1);
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
    expect(environmentIds(manager.lines)).toHaveLength(DEFAULT_MAX_CONCURRENCY);
  });

  it('takes its concurrency from the config file', async () => {
    const manager = await startManager({ config: { maxConcurrency: 2 } });
    const statuses = await Promise.all(
      [1, 2, 3].map((i) => fetch(manager.url(`/${i}?wait=400`)).then((r) => r.status))
    );
    expect(statuses.sort()).toEqual([201, 201, 429]);
    expect(environmentIds(manager.lines)).toHaveLength(2);
  });

  it('follows a change to the config file without a restart', async () => {
    const manager = await startManager({ config: { maxConcurrency: 1 } });
    const refused = await Promise.all(
      [1, 2].map((i) => fetch(manager.url(`/${i}?wait=300`)).then((r) => r.status))
    );
    expect(refused.sort()).toEqual([201, 429]);

    await manager.writeConfig({ maxConcurrency: 3 });
    await sleep(CONFIG_POLLS_MS);
    const allowed = await Promise.all(
      [1, 2, 3].map((i) => fetch(manager.url(`/${i}?wait=300`)).then((r) => r.status))
    );
    expect(allowed).toEqual([201, 201, 201]);
  });

  it('says once that the config file cannot be read, and keeps the last good one', async () => {
    const manager = await startManager({ config: { maxConcurrency: 2 } });
    await manager.writeConfig({ maxConcurrency: 0 });
    await manager.waitFor((l) => /no positive maxConcurrency/.test(l));
    await sleep(CONFIG_POLLS_MS);
    expect(manager.lines.filter((l) => /no positive maxConcurrency/.test(l))).toHaveLength(1);
    const statuses = await Promise.all(
      [1, 2, 3].map((i) => fetch(manager.url(`/${i}?wait=400`)).then((r) => r.status))
    );
    expect(statuses.sort()).toEqual([201, 201, 429]);
  });

  it('fails the invocation when the handler cannot be loaded', async () => {
    const manager = await startManager({ handler: 'export const notHandler = 1;' });
    const response = await fetch(manager.url('/'));
    expect(response.status).toBe(502);
    expect((await response.json()).errorMessage).toMatch(/does not export a function named "handler"/);
    await manager.waitFor((l) => /failed to initialize/.test(l));
  });
});
