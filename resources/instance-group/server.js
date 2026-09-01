import express from 'express';

// Glass Garden gives every instance its own PORT, because they all share one machine here.
// In a real deployment they would each be on their own machine, and could all listen on the same port.
const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

const app = express();

app.get('/', (req, res) => {
  // This prefix sends a line to the Metrics tab instead of the Logs tab. The number is one
  // observation, not a running total - print one per event and they are summed per second
  console.log(`gg:metric/1 ${JSON.stringify({ name: 'requests', value: 1 })}`);

  res.type('text/plain').send(`Hello from the instance on :${port}\n`);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
