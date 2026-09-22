import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Glass Garden gives every instance its own PORT, because they all share one machine here.
// In a real deployment they would each be on their own machine, and could all listen on the
// same port. Raise the instance count in the Config tab and each new one gets its own
const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

// Embedded Metric Format: the shape CloudWatch extracts metrics from a log line, and how
// anything running here puts a number on its own Metrics tab. Open this node's Metrics tab to
// see the line below plotted, and pin it to the canvas from there
function putMetric(name, value, unit) {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          { Namespace: 'glass-garden', Dimensions: [[]], Metrics: [{ Name: name, Unit: unit }] }
        ]
      },
      [name]: value
    })
  );
}

// Once at startup, so the name is on the chart before the first request arrives
putMetric('requests', 0, 'Count');

const page = await readFile('public/index.html', 'utf8');

function render(values) {
  return page.replace(/{{(\w+)}}/g, (_, name) => values[name]);
}

let served = 0;

// No framework and no dependencies, so there is nothing to install before this can run. The
// page names the port it was answered on, so refreshing shows the balancer moving between
// instances rather than always reaching the same one
createServer((request, response) => {
  served += 1;
  putMetric('requests', 1, 'Count');
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(render({ port, served }));
}).listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
