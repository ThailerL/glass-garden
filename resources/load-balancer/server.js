import http from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

let cursor = 0;

// Written by the orchestrator whenever the set of targets changes
async function readTargets() {
  let contents;
  try {
    contents = await readFile('targets.json', 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Cannot read targets.json: ${error.message}`);
  }

  let targets;
  try {
    targets = JSON.parse(contents);
  } catch (error) {
    throw new Error(`targets.json is not valid JSON (${error.message}): ${contents}`);
  }

  if (!Array.isArray(targets) || targets.some((target) => !Number.isInteger(target))) {
    throw new Error(`targets.json is not a list of ports: ${contents}`);
  }
  return targets;
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
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  // Read per request so a rewrite takes effect without restarting the process
  let targets;
  try {
    targets = await readTargets();
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
  for (let attempt = 0; attempt < targets.length; attempt++) {
    cursor = (cursor + 1) % targets.length;
    const target = targets[cursor];
    try {
      const upstream = await forward(target, req, body);
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res);
      return;
    } catch (error) {
      failures.push(`:${target} ${error.message}`);
    }
  }

  const detail = failures.join('\n');
  console.error(`No upstream reachable:\n${detail}`);
  res.writeHead(502, { 'content-type': 'text/plain' }).end(`No upstream reachable\n\n${detail}\n`);
});

server.listen(port, () => {
  console.log(`Load balancer running on http://localhost:${port}`);
});