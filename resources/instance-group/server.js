import express from 'express';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

// Glass Garden gives every instance its own PORT, because they all share one machine here.
// In a real deployment they would each be on their own machine, and could all listen on the same port.
const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

// CloudWatch metrics, written the way a Lambda writes them: as a line on stdout that the
// Metrics tab reads. Each addMetric is one observation, not a running total
const metrics = new Metrics();

const app = express();

app.get('/', (req, res) => {
  metrics.addMetric('requests', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();

  res.type('text/plain').send(`Hello from the instance on :${port}\n`);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
