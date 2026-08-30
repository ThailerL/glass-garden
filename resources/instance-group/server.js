import express from 'express';

// Every instance of this server runs on the same machine, so each one needs a port of its
// own. In a real deployment they would sit on separate machines and could share one.
// Glass Garden sets PORT, which is unique across instances
const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

let hits = 0;

const app = express();

app.get('/', (req, res) => {
  hits += 1;

  // Nothing is shared between instances, so each one counts only the requests the load
  // balancer sent its way, and a restart takes the count with it
  res
    .type('text/plain')
    .send(`Hello from the instance on :${port}\nIt has served ${hits} requests since it started.\n`);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
