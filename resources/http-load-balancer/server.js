import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Health, reasonOf } from './health.js';

const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

// The host stores one datapoint per second, so reporting less often leaves gaps
const TICK_MS = 1000;

let cursor = 0;

// Embedded Metric Format: the shape CloudWatch extracts metrics from in a log line. A metric
// always carries the same dimensions, never some readings with and some without, so the Metrics
// tab can break it down. `fold` says the per-dimension lines add up to a total worth drawing
function putMetric(name, value, unit, dimensions = {}, fold = true) {
  const named = Object.keys(dimensions);
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'glass-garden',
            Dimensions: named.length === 0 ? [[]] : fold ? [[], named] : [named],
            Metrics: [{ Name: name, Unit: unit }],
          },
        ],
      },
      [name]: value,
      ...dimensions,
    }),
  );
}

// A request forwarded, for the canvas to draw; the balancer is the side left unnamed
const reportHop = (port) =>
  console.log('gg:event ' + JSON.stringify({ kind: 'hop', at: Date.now(), to: { port } }));

// Which targets are actually being sent to, so the canvas can dim the rest. Sent every tick
// rather than on change, so a page that reloads mid-run gets the picture back
const reportRouting = (ports) =>
  console.log('gg:event ' + JSON.stringify({ kind: 'routing', at: Date.now(), ports }));

async function readConfig() {
  let contents;
  try {
    contents = await readFile('config.json', 'utf8');
  } catch (error) {
    throw new Error(`Cannot read config.json: ${error.message}`);
  }
  // The canvas may be mid-write, so a torn read is a real event rather than a bug
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`config.json is not valid JSON (${error.message}): ${contents}`);
  }
}

function pick(algorithm, targets) {
  if (algorithm === 'random') return targets[Math.floor(Math.random() * targets.length)];
  cursor = (cursor + 1) % targets.length;
  return targets[cursor];
}

// Says a message once until it changes; called with nothing, forgets it
function onChange(say) {
  let last;
  return (message) => {
    if (message && message !== last) say(message);
    last = message;
  };
}

const complainAboutConfig = onChange(console.error);
const announceFailOpen = onChange(console.log);

const health = new Health({
  onChange(target, state, reason) {
    if (state === 'healthy') console.log(`:${target} healthy`);
    else console.error(`:${target} unhealthy: ${reason}`);
  }
});

function reportHealth(targets) {
  const states = health.states(targets);
  const healthy = states.filter(({ state }) => state === 'healthy').length;
  const unhealthy = states.filter(({ state }) => state === 'unhealthy').length;
  putMetric('healthy hosts', healthy, 'Count');
  putMetric('unhealthy hosts', unhealthy, 'Count');
  for (const { port, state } of states) {
    putMetric('target health', state === 'healthy' ? 1 : 0, 'Count', { target: String(port) }, false);
  }
  // choose(), not the healthy ones: with none healthy an ALB routes to every target
  reportRouting(health.choose(targets));
  announceFailOpen(
    healthy === 0 && unhealthy > 0
      ? `No healthy targets: routing to all ${targets.length} regardless, as an ALB does`
      : undefined
  );
}

async function tick() {
  let config;
  try {
    config = await readConfig();
  } catch (error) {
    complainAboutConfig(error.message);
    return;
  }
  complainAboutConfig();
  const { targets } = config;
  void health.tick(targets, config.healthCheck);
  reportHealth(targets);
}

// Chained rather than setInterval so ticks cannot pile up; must never throw, or health flatlines
async function loop() {
  try {
    await tick();
  } catch (error) {
    console.error(`Health check failed: ${reasonOf(error)}`);
  }
  setTimeout(loop, TICK_MS);
}

function forward(target, req, body) {
  const forwardedFor = [req.headers['x-forwarded-for'], req.socket.remoteAddress]
    .filter(Boolean)
    .join(', ');

  return new Promise((resolve, reject) => {
    const upstream = http.request(
      {
        host: 'localhost',
        port: target,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, 'x-forwarded-for': forwardedFor }
      },
      resolve
    );
    upstream.on('error', reject);
    upstream.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  // Read per request so a rewrite takes effect without restarting the process
  let algorithm, targets;
  try {
    ({ algorithm, targets } = await readConfig());
  } catch (error) {
    console.error(error.message);
    // Answers the balancer wrote itself, split by the code it sent, the way an ALB keeps its
    // own HTTPCode_ELB_5XX_Count apart from the targets': 500 it could not read its settings,
    // 503 nothing is wired to it, 502 the target it chose could not be reached
    putMetric('balancer errors', 1, 'Count', { status: '500' });
    res.writeHead(500, { 'content-type': 'text/plain' }).end(`${error.message}\n`);
    return;
  }

  // No targets at all is the one case an ALB answers itself; all-unhealthy still routes
  if (targets.length === 0) {
    putMetric('balancer errors', 1, 'Count', { status: '503' });
    res
      .writeHead(503, { 'content-type': 'text/plain' })
      .end('No targets: nothing running is wired to this load balancer\n');
    return;
  }

  // Counted once a target is chosen, the way an ALB counts a request, so a request it turned
  // away above is not one and every reading here names the target it belongs to
  const target = pick(algorithm, health.choose(targets));
  const dimension = String(target);
  putMetric('requests', 1, 'Count', { target: dimension });
  reportHop(target);

  const started = Date.now();
  let upstream;
  try {
    upstream = await forward(target, req, body);
  } catch (error) {
    putMetric('target connection errors', 1, 'Count', { target: dimension });
    // The request failed, whatever the reason, so it is one for the error rate below
    putMetric('target errors', 1, 'Count', { target: dimension });
    // The 502 is the balancer's own answer, not the target's, so it is counted as its own too
    putMetric('balancer errors', 1, 'Count', { status: '502' });
    const message = `:${target} unreachable: ${reasonOf(error)}`;
    console.error(message);
    res.writeHead(502, { 'content-type': 'text/plain' }).end(`${message}\n`);
    return;
  }

  // The target's own time, ending at its first response header rather than at the last byte
  // of the body, as an ALB reports it. Named for the span it covers, so it cannot be read as
  // the round trip a client sees, which a request generator reports as response time
  putMetric('target response time', Date.now() - started, 'Milliseconds', { target: dimension });
  // A 1 when the target failed and a 0 when it did not, so the Average of `target errors` is
  // the share of this target's requests that failed and its Sum is how many. An ALB leaves the
  // zeros out and expects you to divide by its request count instead; S3 records them the way
  // this does. Try it: put two targets behind the balancer, break one, and compare their lines
  putMetric('target errors', upstream.statusCode >= 500 ? 1 : 0, 'Count', { target: dimension });

  res.writeHead(upstream.statusCode, upstream.headers);
  // The headers are already out, so a target dying mid-body can only be logged
  await pipeline(upstream, res).catch((error) =>
    console.error(`:${target} failed mid-response: ${reasonOf(error)}`)
  );
});

// The canvas writes config.json before it starts this process, so a missing one is a bug
// worth stopping on rather than a state to serve 503s from
await readConfig().catch((error) => {
  console.error(`Load balancer failed to start: ${error.message}`);
  process.exit(1);
});

// Every count once, so the names are in the Metrics tab before anything happens. Not
// `target health`, which is only ever per-target
for (const name of [
  'requests',
  'target errors',
  'target connection errors',
  'balancer errors',
  'healthy hosts',
  'unhealthy hosts'
]) {
  putMetric(name, 0, 'Count');
}

server.listen(port, () => {
  console.log(`Load balancer running on http://localhost:${port}`);
  void loop();
});