import express from 'express';

// Glass Garden gives every instance its own PORT, because they all share one machine here.
// In a real deployment they would each be on their own machine, and could all listen on the same port.
const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

let hits = 0;

const app = express();

app.get('/', (req, res) => {
  hits += 1;

  // Nothing is shared between instances, so each counts only the requests it was sent
  res
    .type('text/plain')
    .send(`Hello from the instance on :${port}\nIt has served ${hits} requests since it started.\n`);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
