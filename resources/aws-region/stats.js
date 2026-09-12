// What each resource is holding, for the metrics its node shows. There is no request to
// hang these off, so they are sampled on a timer, and only the resources the canvas owns
// are asked about. A resource that has just been removed answers with an error rather than
// a reading, and is simply left out of the sample.
import { jsonApi, listObjectsPage, xmlText } from './aws-api.js';

async function bucketReading(region, bucket) {
  let objects = 0;
  let bytes = 0;
  let token;
  do {
    const page = await listObjectsPage(region, bucket, token);
    if (page.status !== 200) return undefined;
    for (const entry of page.entries) {
      objects += 1;
      bytes += Number(xmlText(entry, 'Size') ?? 0);
    }
    token = page.nextToken;
  } while (token !== undefined);
  return { objects: [objects, 'Count'], size: [bytes / 1e6, 'Megabytes'] };
}

// A message is in flight once it has been received and its visibility timeout has not yet
// lapsed; until then it is waiting to be picked up. The emulator counts both for us
async function queueReading(region, queueName) {
  const [status, attributes] = await jsonApi(region, 'sqs', 'AmazonSQS.GetQueueAttributes', {
    QueueUrl: queueName,
    AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
  });
  if (status !== 200) return undefined;
  const { Attributes: values = {} } = attributes;
  return {
    messages: [Number(values.ApproximateNumberOfMessages ?? 0), 'Count'],
    'in flight': [Number(values.ApproximateNumberOfMessagesNotVisible ?? 0), 'Count']
  };
}

async function tableReading(region, tableName) {
  const [status, described] = await jsonApi(region, 'dynamodb', 'DynamoDB_20120810.DescribeTable', {
    TableName: tableName
  });
  if (status !== 200) return undefined;
  return { items: [Number(described.Table?.ItemCount ?? 0), 'Count'] };
}

const READERS = { s3: bucketReading, sqs: queueReading, dynamodb: tableReading };

// owners is the topology's: one map of resource name to node id per service
export async function sampleStats(region, owners) {
  const sample = { s3: {}, sqs: {}, dynamodb: {} };
  for (const [service, read] of Object.entries(READERS)) {
    for (const name of Object.keys(owners[service] ?? {})) {
      const reading = await read(region, name);
      if (reading !== undefined) sample[service][name] = reading;
    }
  }
  return sample;
}
