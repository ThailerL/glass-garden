// Test helpers for the hidden harnesses; not a subdirectory, so never mounted
import { afterEach } from 'vitest';
import { EVENT_PREFIX } from './_harness/lib.js';
import net from 'node:net';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESOURCES = path.dirname(fileURLToPath(import.meta.url));
// The resource-files plugin leaves tests out the same way
function notTest(source) {
  return !path.basename(source).includes('.test.');
}

// A resource's directory as withHarness lays it in the VM, in a temp directory of its own
export async function layResource(name) {
  const cwd = await mkdtemp(path.join(tmpdir(), `${name}-`));
  const options = { recursive: true, filter: notTest };
  await cp(path.join(RESOURCES, name), cwd, options);
  await cp(path.join(RESOURCES, '_harness'), path.join(cwd, '_harness'), options);
  return cwd;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `find` may be async; its first truthy answer is returned
export async function waitUntil(find, what, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await find();
    if (found) return found;
    await sleep(20);
  }
  throw new Error(what());
}

export function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const cleanups = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

export function onCleanup(cleanup) {
  cleanups.push(cleanup);
}

// Runs a harness in cwd and sorts what it prints the way the canvas does. Both are gone after the test
export function spawnHarness(script, { cwd, env = {} }) {
  const child = spawn('node', [script], { cwd, env: { ...process.env, ...env } });
  const stdout = [];
  const stderr = [];
  const metrics = [];
  const hops = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (line.startsWith(EVENT_PREFIX)) return hops.push(JSON.parse(line.slice(EVENT_PREFIX.length)));
    if (!line.startsWith('{')) return stdout.push(line);
    const parsed = JSON.parse(line);
    const [{ Metrics, Dimensions }] = parsed._aws.CloudWatchMetrics;
    for (const { Name, Unit } of Metrics) {
      metrics.push({
        name: Name,
        unit: Unit,
        value: parsed[Name],
        status: parsed.status,
        dimensions: Dimensions
      });
    }
  });
  readline.createInterface({ input: child.stderr }).on('line', (line) => stderr.push(line));
  const exited = new Promise((resolve) => child.on('exit', resolve));

  onCleanup(async () => {
    child.kill();
    await exited;
    await rm(cwd, { recursive: true, force: true });
  });
  return { stdout, stderr, metrics, hops, exited };
}
