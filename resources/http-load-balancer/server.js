import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

let cursor = 0;

// Embedded Metric Format: the shape CloudWatch extracts metrics from in a log line. A metric
// is either always about a target or never about one, so its dimensions never vary between
// readings and the per-target lines always add up to the total
function putMetric(name, value, unit, target) {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'glass-garden',
            Dimensions: target === undefined ? [[]] : [[], ['target']],
            Metrics: [{ Name: name, Unit: unit }],
          },
        ],
      },
      [name]: value,
      target,
    }),
  );
}

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

// A refused connection arrives as an AggregateError whose own message is empty, one entry per
// address tried, so the code is the only thing that names the failure
const reasonOf = (error) => error.message || error.code || String(error);

function forward(target, req, body) {
  return new Promise((resolve, reject) => {
    const upstream = http.request(
      {
        host: 'localhost',
        port: target,
        path: req.url,
        method: req.method,
        headers: req.headers
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
    putMetric('balancer errors', 1, 'Count');
    res.writeHead(500, { 'content-type': 'text/plain' }).end(`${error.message}\n`);
    return;
  }

  if (targets.length === 0) {
    putMetric('balancer errors', 1, 'Count');
    res
      .writeHead(503, { 'content-type': 'text/plain' })
      .end('No targets: nothing running is wired to this load balancer\n');
    return;
  }

  // Counted once a target is chosen, the way an ALB counts a request, so a request it turned
  // away above is not one and every reading here names the target it belongs to
  const target = pick(algorithm, targets);
  const dimension = String(target);
  putMetric('requests', 1, 'Count', dimension);

  const started = Date.now();
  let upstream;
  try {
    upstream = await forward(target, req, body);
  } catch (error) {
    putMetric('connection errors', 1, 'Count', dimension);
    // The 502 is the balancer's own answer, not the target's, so it is not a target failure
    putMetric('balancer errors', 1, 'Count');
    const message = `:${target} unreachable: ${reasonOf(error)}`;
    console.error(message);
    res.writeHead(502, { 'content-type': 'text/plain' }).end(`${message}\n`);
    return;
  }

  // The target's own time, ending at its first response header rather than at the last byte
  // of the body, which is what an ALB reports as target response time
  putMetric('latency', Date.now() - started, 'Milliseconds', dimension);
  if (upstream.statusCode >= 500) putMetric('failures', 1, 'Count', dimension);

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

// Every count once, so the names are in the Metrics tab before anything happens
for (const name of ['requests', 'failures', 'connection errors', 'balancer errors']) {
  putMetric(name, 0, 'Count');
}

server.listen(port, () => {
  console.log(`Load balancer running on http://localhost:${port}`);
});