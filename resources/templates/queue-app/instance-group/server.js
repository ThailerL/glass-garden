import express from 'express';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { readFile } from 'node:fs/promises';

const queueUrl = process.env.SQS_QUEUE_URL;
if (!queueUrl) {
  throw new Error('SQS_QUEUE_URL is not set. Connect this instance group to one queue node.');
}

// Glass Garden gives every instance its own PORT, because they all share one machine here.
// In a real deployment they would each be on their own machine, and could all listen on the same port.
const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

// The real AWS SDK against the local AWS region. AWS_ENDPOINT_URL, AWS_REGION and the
// credentials all arrive in the environment (you can see them in the Config tab), so
// there is nothing to configure here
const sqs = new SQSClient({});

// Embedded Metric Format: the shape CloudWatch extracts metrics from a log line, and how
// anything running here puts a number on its own Metrics tab
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

// Once at startup, so the name is in the Metrics tab before anybody signs up
putMetric('signups', 0, 'Count');

const page = await readFile('public/index.html', 'utf8');

function render(values) {
  return page.replace(/{{(\w+)}}/g, (_, name) => values[name]);
}

const app = express();

// Two body formats, because two kinds of client sign up here: the request generator sends
// JSON, and the form on the page below sends what every HTML form sends
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => {
  res.type('html').send(render({ queue: queueUrl.split('/').pop() }));
});

app.post('/signup', async (req, res) => {
  const email = req.body.email || 'nobody@example.com';
  const password = req.body.password || 'hunter2';

  // The message is the whole handover. Everything the worker needs travels in the body,
  // because by the time it runs this request is long finished
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ email, password })
    })
  );

  // One line per signup, the way a Lambda reports one line per invocation. There is nothing to
  // batch here: Glass Garden folds every line printed in the same second into the one datapoint
  // it stores, so reporting each signup as it happens is what keeps the sample count honest -
  // a hundred signups in a second is a hundred samples, not one reading of 100
  putMetric('signups', 1, 'Count');

  // Answering here, before a single password has been hashed, is the entire point of the
  // pattern. This response takes a couple of milliseconds whether the worker is keeping up or
  // is an hour behind, which is why the generator's response time stays flat on its chart
  // while the queue's depth climbs
  if (req.is('application/x-www-form-urlencoded')) {
    // Relative, because the preview serves this app under a path prefix, the way an app behind
    // a path-routing proxy is. A redirect to '/' would leave the app entirely
    return res.redirect('./');
  }
  res.status(202).json({ status: 'queued' });
});

// Express hands a rejected handler here. This server is fine, the queue is not: an edge may
// have been removed, which the region answers with a message saying so
app.use((error, req, res, next) => {
  console.error('queue unavailable:', error.message);
  res.status(503).type('text/plain').send(`Queue unavailable: ${error.message}\n`);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
