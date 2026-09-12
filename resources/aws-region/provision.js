// Starting an AWS node is provisioning it, and there is no config file to write: the
// emulator's API is its whole configuration surface, so a node's settings arrive here as
// the calls that apply them. Called from /control/*, never from user code.
import {
  jsonApi,
  listObjectsPage,
  objectPath,
  s3Request,
  textOf,
  unescapeXml,
  xmlText
} from './aws-api.js';
import { escapeXml } from './lib.js';

const S3_NAMESPACE = 'http://s3.amazonaws.com/doc/2006-03-01/';
// What a bucket tells a function about, as a Lambda trigger's default does
const NOTIFIED_EVENTS = ['s3:ObjectCreated:*', 's3:ObjectRemoved:*']
  .map((event) => `<Event>${event}</Event>`)
  .join('');

const PROVISION = {
  s3: async (region, name, config) => {
    const created = await s3Request(region, 'PUT', `/${name}`);
    // 409 is BucketAlreadyOwnedByYou territory: provisioning is idempotent
    if (created.status !== 200 && created.status !== 409) {
      throw new Error(`CreateBucket answered ${created.status}`);
    }
    // Absent leaves the configuration alone: start provisions with launch config only and
    // must not wipe what update wrote
    if (config.notifications) await putBucketNotifications(region, name, config.notifications);
    return { bucket: name };
  },

  sqs: async (region, name, config) => {
    // Created bare and then configured, rather than created with its attributes: a
    // CreateQueue naming attributes that differ from an existing queue is an error, and
    // provisioning runs again every time the node starts with edited settings
    const [status, created] = await jsonApi(region, 'sqs', 'AmazonSQS.CreateQueue', {
      QueueName: name
    });
    if (status !== 200) throw new Error(`CreateQueue failed: ${JSON.stringify(created)}`);
    const attributes = config.attributes ?? {};
    if (Object.keys(attributes).length > 0) {
      const [updated, answer] = await jsonApi(region, 'sqs', 'AmazonSQS.SetQueueAttributes', {
        QueueUrl: created.QueueUrl,
        Attributes: Object.fromEntries(
          Object.entries(attributes).map(([key, value]) => [key, String(value)])
        )
      });
      if (updated !== 200) throw new Error(`SetQueueAttributes failed: ${JSON.stringify(answer)}`);
    }
    return { queueUrl: created.QueueUrl };
  },

  dynamodb: async (region, name, config) => {
    const [status, created] = await jsonApi(region, 'dynamodb', 'DynamoDB_20120810.CreateTable', {
      TableName: name,
      KeySchema: config.keySchema ?? [{ AttributeName: 'pk', KeyType: 'HASH' }],
      AttributeDefinitions: config.attributeDefinitions ?? [
        { AttributeName: 'pk', AttributeType: 'S' }
      ],
      BillingMode: 'PAY_PER_REQUEST'
    });
    if (status === 200 || (created.__type ?? '').endsWith('ResourceInUseException')) {
      return { table: name };
    }
    throw new Error(`CreateTable failed: ${JSON.stringify(created)}`);
  }
};

// config carries the service-specific create-time settings a node's definition sends
// (queue attributes, table key schema); everything else gets a teachable default
export async function provision(region, service, name, config = {}) {
  const run = PROVISION[service];
  if (!run) throw new Error(`unknown service ${service}`);
  return run(region, name, config);
}

// One QueueConfiguration per queue; an empty list clears. The ARN's region and account are
// what the emulator validates the destination against, and match the URLs the host mints
async function putBucketNotifications(region, bucket, queues) {
  const configurations = queues.map(
    ({ id, queueName }) =>
      `<QueueConfiguration><Id>${escapeXml(id)}</Id>` +
      `<Queue>arn:aws:sqs:us-east-1:000000000000:${escapeXml(queueName)}</Queue>` +
      NOTIFIED_EVENTS +
      '</QueueConfiguration>'
  );
  const body =
    `<NotificationConfiguration xmlns="${S3_NAMESPACE}">` +
    `${configurations.join('')}</NotificationConfiguration>`;
  const response = await s3Request(region, 'PUT', `/${bucket}?notification`, body, {
    'content-type': 'application/xml'
  });
  if (response.status !== 200) {
    throw new Error(
      `PutBucketNotificationConfiguration answered ${response.status}: ${textOf(response)}`
    );
  }
}

const DEPROVISION = {
  // Emptied a page at a time: a bucket the emulator still holds objects for refuses to go
  s3: async (region, name) => {
    for (;;) {
      const page = await listObjectsPage(region, name);
      if (page.status !== 200) return;
      if (page.entries.length === 0) break;
      for (const entry of page.entries) {
        const key = unescapeXml(xmlText(entry, 'Key') ?? '');
        await s3Request(region, 'DELETE', objectPath(name, key));
      }
    }
    await s3Request(region, 'DELETE', `/${name}`);
  },

  sqs: async (region, name) => {
    const [status, found] = await jsonApi(region, 'sqs', 'AmazonSQS.GetQueueUrl', {
      QueueName: name
    });
    if (status === 200) {
      await jsonApi(region, 'sqs', 'AmazonSQS.DeleteQueue', { QueueUrl: found.QueueUrl });
    }
  },

  dynamodb: (region, name) =>
    jsonApi(region, 'dynamodb', 'DynamoDB_20120810.DeleteTable', { TableName: name })
};

export async function deprovision(region, service, name) {
  const run = DEPROVISION[service];
  if (!run) throw new Error(`unknown service ${service}`);
  return run(region, name);
}
