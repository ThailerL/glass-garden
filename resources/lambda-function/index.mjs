import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

// CloudWatch metrics, written the way a Lambda writes them: as a line on stdout that the
// Metrics tab reads. Invocations, errors, duration and cold starts are reported for you, as
// the Lambda service reports them; this object is for whatever your handler counts
const metrics = new Metrics();

// Lambda calls this once per event and waits for the promise. The execution environment
// outlives the invocation: anything created above this line - clients, connections, the
// metrics object - is reused by the next event that lands here. That is what makes a warm
// start faster than a cold one, and why the first request after a quiet spell is slower.
// Watch the Logs tab: each environment is its own stream, and a new one appears whenever
// Glass Garden has to start another to keep up.
//
// Three kinds of event reach this function, and the shape of the event says which:
//
// - A queue that points at this function delivers messages in batches of up to ten, as
//   event.Records. Glass Garden polls the queue on the function's behalf, exactly as the
//   Lambda service does, and deletes the batch from the queue only when the handler returns.
//   Throw instead, and the whole batch comes back after the queue's visibility timeout and
//   is delivered again.
// - A bucket that points at this function sends one event for each object created or
//   removed, also as event.Records, with record.s3 naming the bucket and the key. Each
//   notification is its own invocation, and several can run at once. Throw, and it is
//   delivered again later, the way Lambda retries an asynchronous invocation.
// - A request through a load balancer or the Preview tab arrives as the event a Lambda
//   function URL sends: event.rawPath, event.headers, event.body and so on. What the handler
//   returns becomes the response.
//
// The whole file is an ordinary Lambda handler. It runs unchanged on AWS.
export async function handler(event, context) {
  if (event.Records) {
    for (const record of event.Records) {
      if (record.eventSource === 'aws:s3') {
        console.log(`${record.eventName} ${record.s3.bucket.name}/${record.s3.object.key}`);
      } else {
        console.log(`Message: ${record.body}`);
      }
    }
    return;
  }

  metrics.addMetric('requests', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();

  // A string or a plain object would be sent as-is with a 200. Returning this shape sets
  // the status and headers too. Take longer than the function's timeout to answer, and the
  // invocation fails the way it does on Lambda: "Task timed out"
  return {
    statusCode: 200,
    headers: { 'content-type': 'text/plain' },
    body: `Hello from ${context.functionName}, request ${context.awsRequestId}\n`
  };
}
