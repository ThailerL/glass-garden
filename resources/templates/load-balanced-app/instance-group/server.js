import express from 'express';
import { readFile } from 'node:fs/promises';

// Glass Garden gives every instance its own PORT, because they all share one machine here.
// In a real deployment they would each be on their own machine, and could all listen on the same port.
const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

// The fault this template exists to show, and the reason health checks exist at all. A crashed
// process is the easy failure: the instance goes red on the canvas and everyone can see it.
// This is the hard one. The server stays up, keeps its port, answers every request it is given,
// and every answer is wrong. Nothing outside a health check can tell the difference
let broken = false;

const page = await readFile('public/index.html', 'utf8');

function render(values) {
  return page.replace(/{{(\w+)}}/g, (_, name) => values[name]);
}

const app = express();

app.get('/', (req, res) => {
  // This app counts nothing, though the templates with a database and a bucket do. The load
  // balancer in front of it already reports requests per instance on its own Metrics tab, and
  // it leaves its own health checks out of that count the way a real one does. A second count
  // of the same requests under the same name would be one more number to reconcile

  // A load balancer adds X-Forwarded-For so the app behind it can see the client rather than
  // the balancer. Its presence answers a different question here: whether this page was
  // reached through the balancer, which sends each request to whichever instance is next, or
  // straight to this one. The break button only makes sense in the second case. Through the
  // balancer, the instance that served this page is not the one the button would land on
  const via = req.get('x-forwarded-for') ? 'proxied' : 'direct';

  // The two answers this instance has. A 500 is exactly what the balancer's matcher is watching
  // for: it accepts 200 and nothing else, so two of these in a row (the unhealthy threshold
  // in the balancer's Config tab) take this instance out of rotation
  const view = broken
    ? {
        code: 500,
        state: 'broken',
        status: 'Answering 500 to every request',
        action: 'fix',
        label: 'Fix this instance',
        caption:
          'Still running, so the canvas keeps it green. Two bad answers in a row and the balancer ' +
          "stops sending it traffic. Watch this instance's line fall to zero on the load " +
          "balancer's Metrics tab."
      }
    : {
        code: 200,
        state: 'serving',
        status: 'Serving normally',
        action: 'break',
        label: 'Break this instance',
        caption:
          'The load balancer asks for this page every few seconds. Break this instance and watch ' +
          'what it does.'
      };

  // Through the balancer the page has no button, so its caption says where to find one instead
  const caption =
    via === 'proxied'
      ? 'Reached through the load balancer, which picks a different instance for each request. ' +
        "To break one, open the Web App node's own Preview."
      : view.caption;

  res
    .status(view.code)
    .type('html')
    .send(render({ port, via, ...view, caption }));
});

// Two named routes rather than one toggle, so the file says what each does. They are ordinary
// routes, so a terminal reaches them too: curl -X POST localhost:PORT/break
app.post('/break', (req, res) => {
  broken = true;
  console.log('Broken on purpose: answering 500 to every request');
  // Relative, because the preview serves this app under a path prefix, the way an app behind a
  // path-routing proxy is. A redirect to '/' would leave the app entirely
  res.redirect('./');
});

app.post('/fix', (req, res) => {
  broken = false;
  console.log('Fixed: answering normally again');
  res.redirect('./');
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
