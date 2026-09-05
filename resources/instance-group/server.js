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
// What tells one instance's numbers from another's, here and in CloudWatch: a dimension the
// code declares. Remove it and the instances' lines merge into one
metrics.setDefaultDimensions({ instance: String(port) });

// What the load balancer's health checks call themselves. AWS gives them a user agent of
// their own precisely so an app can tell them apart from real traffic, and this app has to,
// because the path being checked and the path being counted are the same "/"
const HEALTH_CHECKER = 'ELB-HealthChecker/2.0';

const app = express();

app.get('/', (req, res) => {
  // The balancer requests this same path on every instance every few seconds. Counting those
  // would leave a steady stream of requests on the Metrics tab with nobody visiting - which is
  // why a real load balancer leaves its own health checks out of the request count it reports
  if (req.get('user-agent') !== HEALTH_CHECKER) {
    metrics.addMetric('requests', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();
  }

  res.type('text/plain').send(`Hello from the instance on :${port}\n`);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
