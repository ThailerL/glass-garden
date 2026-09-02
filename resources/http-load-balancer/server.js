import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

// Kept in step with the algorithm field of the resource's config schema
const ALGORITHMS = ['round-robin', 'random'];

// Retries after the first attempt. Bounded so one client request cannot turn into a
// connection attempt against every instance of a large pool
const MAX_RETRIES = 3;

let cursor = 0;

// Embedded Metric Format: the shape CloudWatch extracts metrics from in a log line
function putMetric(name, value, unit) {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          { Namespace: 'glass-garden', Dimensions: [[]], Metrics: [{ Name: name, Unit: unit }] },
        ],
      },
      [name]: value,
    }),
  );
}

async function readConfig() {
  let contents;
  try {
    contents = await readFile('config.json', 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { algorithm: 'round-robin', targets: [] };
    throw new Error(`Cannot read config.json: ${error.message}`);
  }

  let config;
  try {
    config = JSON.parse(contents);
  } catch (error) {
    throw new Error(`config.json is not valid JSON (${error.message}): ${contents}`);
  }

  const { algorithm, targets } = config ?? {};
  if (!ALGORITHMS.includes(algorithm)) {
    throw new Error(`config.json names an unknown algorithm: ${contents}`);
  }
  if (!Array.isArray(targets) || targets.some((target) => !Number.isInteger(target))) {
    throw new Error(`config.json targets are not a list of ports: ${contents}`);
  }
  return { algorithm, targets };
}

// Advanced once per request rather than once per attempt, so retrying past a dead target
// does not spend its turn and skew the split
function rotate(targets) {
  cursor = (cursor + 1) % targets.length;
  return [...targets.slice(cursor), ...targets.slice(0, cursor)];
}

// Fisher-Yates. A whole order rather than a single pick, so a refused target still falls
// through to the rest
function shuffle(targets) {
  const order = [...targets];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function attemptOrder(algorithm, targets) {
  return algorithm === 'random' ? shuffle(targets) : rotate(targets);
}

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
  const started = Date.now();
  res.on('finish', () => {
    putMetric('requests', 1, 'Count');
    putMetric('latency', Date.now() - started, 'Milliseconds');
    if (res.statusCode >= 500) putMetric('failures', 1, 'Count');
  });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  // Read per request so a rewrite takes effect without restarting the process
  let algorithm, targets;
  try {
    ({ algorithm, targets } = await readConfig());
  } catch (error) {
    console.error(error.message);
    res.writeHead(500, { 'content-type': 'text/plain' }).end(`${error.message}\n`);
    return;
  }

  if (targets.length === 0) {
    res
      .writeHead(503, { 'content-type': 'text/plain' })
      .end('No targets: nothing running is wired to this load balancer\n');
    return;
  }

  // A target can die between rewrites, so a refused connection falls through to the next
  const failures = [];
  for (const target of attemptOrder(algorithm, targets).slice(0, MAX_RETRIES + 1)) {
    try {
      const upstream = await forward(target, req, body);
      res.writeHead(upstream.statusCode, upstream.headers);
      // Caught here rather than by the retry: the headers are already out, so a target dying
      // mid-body can only be logged
      await pipeline(upstream, res).catch((error) =>
        console.error(`:${target} failed mid-response: ${error.message}`)
      );
      return;
    } catch (error) {
      failures.push(`:${target} ${error.message}`);
    }
  }

  const summary = `No upstream reachable, tried ${failures.length} of ${targets.length}`;
  const detail = failures.join('\n');
  console.error(`${summary}:\n${detail}`);
  res.writeHead(502, { 'content-type': 'text/plain' }).end(`${summary}\n\n${detail}\n`);
});

server.listen(port, () => {
  console.log(`Load balancer running on http://localhost:${port}`);
});