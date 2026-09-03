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
// The cap the manager holds until the node's config can set it
const MAX_ENVIRONMENTS = 5;

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

async function startManager({ handler = ECHO_HANDLER, handlerFile = 'index.mjs' } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'function-manager-'));
  await writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(dir, handlerFile), handler);
  const port = await freePort();
  const child = spawn('node', [MANAGER], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: String(port),
      AWS_LAMBDA_FUNCTION_NAME: 'tested'
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
      Array.from({ length: MAX_ENVIRONMENTS + 1 }, (_, i) =>
        fetch(manager.url(`/${i}?wait=400`))
      )
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([...Array(MAX_ENVIRONMENTS).fill(201), 429]);
    const refused = responses.find((r) => r.status === 429);
    expect(refused.headers.get('x-amzn-errortype')).toBe('TooManyRequestsException');
    expect(await refused.json()).toEqual({ message: 'Rate exceeded' });
    expect(environmentIds(manager.lines)).toHaveLength(MAX_ENVIRONMENTS);
  });

  it('fails the invocation when the handler cannot be loaded', async () => {
    const manager = await startManager({ handler: 'export const notHandler = 1;' });
    const response = await fetch(manager.url('/'));
    expect(response.status).toBe(502);
    expect((await response.json()).errorMessage).toMatch(/does not export a function named "handler"/);
    await manager.waitFor((l) => /failed to initialize/.test(l));
  });
});
