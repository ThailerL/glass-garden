// The harness under real Node: the same code the VM runs, minus the VM
import { describe, expect, it } from 'vitest';
import { freePort, layResource, onCleanup, spawnHarness, waitUntil } from '../harness-testing.js';
import { bodyOf } from '../_harness/lib.js';
import http from 'node:http';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// With the author's module beside the harness, as the canvas lays it
async function externalSystem(code, endpoints = []) {
  const cwd = await layResource('external-system');
  await writeFile(path.join(cwd, 'api.mjs'), code);
  // Swapped in whole, so a re-read never catches it half written
  const connect = async (list) => {
    await writeFile(path.join(cwd, 'endpoints.next'), JSON.stringify(list));
    await rename(path.join(cwd, 'endpoints.next'), path.join(cwd, 'endpoints.json'));
  };
  await connect(endpoints);
  const port = await freePort();
  const { stdout, stderr, metrics, hops, exited } = spawnHarness('server.js', {
    cwd,
    env: { PORT: String(port), GG_ENDPOINTS_POLL_MS: '50' }
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
    connect,
    call: (url, init) => fetch(`http://localhost:${port}${url}`, init),
    // Flattened across seconds
    readings: (name) => metrics.filter((m) => m.name === name).flatMap((m) => [m.value].flat()),
    waitFor: (find, what) => waitUntil(find, () => `${what}; saw ${JSON.stringify(metrics)}`)
  };
}

// A reader's node the service sends to, answering every request with one status
async function receiver(status = 200) {
  const received = [];
  const server = http.createServer(async (req, res) => {
    const body = (await bodyOf(req)).toString();
    received.push({ method: req.method, path: req.url, body });
    res.writeHead(status).end(`received ${received.length}`);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  onCleanup(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port, received };
}

// Sends what it was called with on to every node it is connected to
const FORWARD = `
let forwarded = 0;
export async function handle(request, { endpoints }) {
  const body = await request.text();
  const answers = [];
  for (const endpoint of endpoints()) {
    try {
      const response = await endpoint.send('/webhooks', { method: 'POST', body });
      answers.push(endpoint.name + ' ' + response.status + ' ' + (await response.text()));
    } catch (error) {
      answers.push(endpoint.name + ' ' + error.message + ' ' + error.cause?.code);
    }
  }
  forwarded += 1;
  return Response.json({ forwarded, answers });
}
`;

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
    const api = await externalSystem(ECHO);
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
    const api = await externalSystem(ECHO);
    await api.ready;
    await api.call('/from/node-7/charges');
    await api.call('/from/node-9');
    // Its stdout can reach the test after the answer does
    await waitUntil(
      () => api.hops.length >= 2,
      () => 'Never drew both calls'
    );
    expect(api.hops.map((hop) => hop.from)).toEqual([{ node: 'node-7' }, { node: 'node-9' }]);
  });

  // A shell's curl, say, has no edge to be drawn on
  it('answers a call with no caller without drawing it', async () => {
    const api = await externalSystem(ECHO);
    await api.ready;
    const response = await api.call('/charges');
    expect(await response.json()).toMatchObject({ path: '/charges' });
    expect(api.hops).toEqual([]);
  });

  it('answers 500 and logs why when the handler throws', async () => {
    const api = await externalSystem(`export function handle() { throw new Error('card declined'); }`);
    await api.ready;
    const response = await api.call('/from/a/charges');
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('card declined');
    expect(api.stderr.join('\n')).toContain('card declined');
  });

  it('answers 500 when the handler returns something other than a Response', async () => {
    const api = await externalSystem(`export function handle() { return { ok: true }; }`);
    await api.ready;
    const response = await api.call('/from/a/charges');
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('must return a Response');
  });
});

describe('sending', () => {
  it('sends to the nodes it is connected to, drawing each call', async () => {
    const target = await receiver();
    const api = await externalSystem(FORWARD, [{ name: 'Bank Events', port: target.port }]);
    await api.ready;
    const response = await api.call('/charges', { method: 'POST', body: 'payment 3' });
    expect(await response.json()).toEqual({ forwarded: 1, answers: ['Bank Events 200 received 1'] });
    expect(target.received).toEqual([{ method: 'POST', path: '/webhooks', body: 'payment 3' }]);
    await waitUntil(
      () => api.hops.length >= 1,
      () => 'Never drew the send'
    );
    expect(api.hops.map((hop) => hop.to)).toEqual([{ port: target.port }]);
  });

  it('reaches a node connected after it started, without forgetting anything', async () => {
    const target = await receiver();
    const api = await externalSystem(FORWARD);
    await api.ready;
    expect(await (await api.call('/charges')).json()).toEqual({ forwarded: 1, answers: [] });
    await api.connect([{ name: 'Bank Events', port: target.port }]);
    let calls = 1;
    const reached = await waitUntil(
      async () => {
        calls += 1;
        const answer = await (await api.call('/charges')).json();
        return answer.answers.length > 0 && answer;
      },
      () => 'Never reached the node connected later'
    );
    expect(reached).toEqual({ forwarded: calls, answers: ['Bank Events 200 received 1'] });
  });

  it('fails a send to a node with nothing running as fetch would', async () => {
    const api = await externalSystem(FORWARD, [{ name: 'Bank Events', port: null }]);
    await api.ready;
    const { answers } = await (await api.call('/charges')).json();
    expect(answers).toEqual(['Bank Events fetch failed ECONNREFUSED']);
    expect(api.hops).toEqual([]);
  });

  it('counts what it sent by status, and each 5xx or unanswered send as an error', async () => {
    const failing = await receiver(503);
    const api = await externalSystem(FORWARD, [
      { name: 'Down', port: null },
      { name: 'Failing', port: failing.port }
    ]);
    await api.ready;
    await api.call('/charges');
    await api.waitFor(
      () => api.readings('outgoing errors').length >= 2,
      'Never counted two outgoing outcomes'
    );
    expect(api.readings('outgoing errors')).toEqual([1, 1]);
    const sent = api.metrics.filter((m) => m.name === 'outgoing requests');
    expect(sent.map((m) => [m.status, [m.value].flat().length])).toEqual([['503', 1]]);
    // A call in is counted apart from the calls it made
    expect(api.readings('errors').filter((value) => value === 1)).toEqual([]);
  });
});

describe('counting', () => {
  it('counts requests by status and each 5xx as an error', async () => {
    const api = await externalSystem(`
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
    const api = await externalSystem(`
      export const metrics = { repeats: 'Count' };
      export function handle() { return new Response(''); }
    `);
    await api.ready;
    await api.waitFor(() => api.readings('repeats').length >= 1, 'Never reported repeats');
    expect(api.readings('repeats').every((value) => value === 0)).toBe(true);
  });

  it("reports what the author's code measured", async () => {
    const api = await externalSystem(`
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
    const api = await externalSystem(`export const nothing = 1;`);
    expect(await api.ready).toEqual({ code: 1 });
    expect(api.stderr.join('\n')).toContain('must export a function named handle');
  });

  it("refuses to start when the author's code does not load, and says why", async () => {
    const api = await externalSystem(`export function handle( {`);
    expect(await api.ready).toEqual({ code: 1 });
    expect(api.stderr.join('\n')).toContain("The system's code did not load");
  });
});
