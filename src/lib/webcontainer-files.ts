import type { FileSystemTree } from '@webcontainer/api';

export const instanceGroupFiles: FileSystemTree = {
	'server.js': {
		file: {
			contents: `import express from 'express';
const app = express();
const port = process.env.PORT || 3000;
// Picked once at startup so every instance of this group serves a different number
const instanceId = Math.floor(Math.random() * 10000);

app.get('/', (req, res) => {
  res.send(\`Hello World from instance \${instanceId}\`);
});

app.listen(port, () => {
  console.log(\`Server running on http://localhost:\${port}\`);
});`
		}
	},
	'package.json': {
		file: {
			contents: `{
  "name": "hello-world",
  "type": "module",
  "dependencies": {
    "express": "latest"
  },
  "scripts": {
    "start": "node server.js"
  }
}`
		}
	}
};

export const loadBalancerFiles: FileSystemTree = {
	'server.js': {
		file: {
			contents: `import http from 'node:http';
import { readFile } from 'node:fs/promises';

const port = process.env.PORT || 3000;
let cursor = 0;

// Written by the orchestrator whenever the set of targets changes
async function readTargets() {
  try {
    return JSON.parse(await readFile('targets.json', 'utf8'));
  } catch {
    return [];
  }
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
  const targets = await readTargets();
  if (targets.length === 0) {
    res.writeHead(503).end('No targets');
    return;
  }

  // A target can die between rewrites, so a refused connection falls through to the next
  for (let attempt = 0; attempt < targets.length; attempt++) {
    cursor = (cursor + 1) % targets.length;
    try {
      const upstream = await forward(targets[cursor], req, body);
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res);
      return;
    } catch {
      continue;
    }
  }

  res.writeHead(502).end('No upstream reachable');
});

server.listen(port, () => {
  console.log(\`Load balancer running on http://localhost:\${port}\`);
});`
		}
	},
	'package.json': {
		file: {
			contents: `{
  "name": "load-balancer",
  "type": "module",
  "scripts": {
    "start": "node server.js"
  }
}`
		}
	}
};
