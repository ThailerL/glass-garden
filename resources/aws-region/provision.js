// Starting an AWS node is provisioning it, and there is no config file to write: the
// emulator's API is its whole configuration surface, so a node's settings arrive here as
// the calls that apply them. Called from /control/*, never from user code.
import { createHash } from 'node:crypto';
import {
  jsonApi,
  lambdaRequest,
  listObjectsPage,
  objectPath,
  s3Request,
  textOf,
  unescapeXml,
  xmlText
} from './aws-api.js';
import { escapeXml } from './lib.js';
import { zipDirectory } from './zip.js';

const FUNCTIONS = '/2015-03-31/functions';
const MAPPINGS = '/2015-03-31/event-source-mappings/';
// Lambda's own default for a queue trigger
const BATCH_SIZE = 10;
// The region and account every URL the host mints names, and the emulator validates against
const arn = (service, resource) => `arn:aws:${service}:us-east-1:000000000000:${resource}`;
const queueArn = (queueName) => arn('sqs', queueName);

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
  },

  // A deploy: the node directory is the package, and every setting of the node's is a
  // configuration call. Run again whenever any of them changes, so only what differs from
  // the function the emulator holds is sent - an unchanged package or configuration keeps
  // its warm environments
  lambda: async (region, name, config) => {
    const { directory, env = {}, timeout, maxConcurrency, queues = [] } = config;
    const zip = await zipDirectory(directory);
    const codeSha256 = createHash('sha256').update(zip).digest('base64');
    const configuration = { Timeout: timeout, Environment: { Variables: env } };
    const [status, found] = await lambdaRequest(region, 'GET', `${FUNCTIONS}/${name}`);
    if (status === 404) {
      const [created, answer] = await lambdaRequest(region, 'POST', FUNCTIONS, {
        FunctionName: name,
        Runtime: 'nodejs22.x',
        Handler: 'index.handler',
        Role: 'arn:aws:iam::000000000000:role/glass-garden',
        Code: { ZipFile: zip.toString('base64') },
        ...configuration
      });
      if (created !== 201) throw new Error(`CreateFunction failed: ${JSON.stringify(answer)}`);
    } else if (status === 200) {
      const current = found.Configuration;
      if (current.CodeSha256 !== codeSha256) {
        await expectOk(lambdaRequest(region, 'PUT', `${FUNCTIONS}/${name}/code`, {
          ZipFile: zip.toString('base64')
        }), 'UpdateFunctionCode');
      }
      if (current.Timeout !== timeout || !sameVariables(current.Environment?.Variables, env)) {
        await expectOk(
          lambdaRequest(region, 'PUT', `${FUNCTIONS}/${name}/configuration`, configuration),
          'UpdateFunctionConfiguration'
        );
      }
    } else {
      throw new Error(`GetFunction failed: ${JSON.stringify(found)}`);
    }
    if (found.Concurrency?.ReservedConcurrentExecutions !== maxConcurrency) {
      await expectOk(
        lambdaRequest(region, 'PUT', `${FUNCTIONS}/${name}/concurrency`, {
          ReservedConcurrentExecutions: maxConcurrency
        }),
        'PutFunctionConcurrency'
      );
    }
    await reconcileMappings(region, name, queues);
    return { functionName: name, codeSha256 };
  }
};

async function expectOk(call, operation) {
  const [status, answer] = await call;
  if (status >= 300) throw new Error(`${operation} failed: ${JSON.stringify(answer)}`);
  return answer;
}

function sameVariables(current = {}, wanted) {
  const keys = Object.keys(wanted);
  return keys.length === Object.keys(current).length && keys.every((k) => current[k] === wanted[k]);
}

// The queues pointing at a function are its event source mappings, one each. Diffed against
// what the emulator holds so a mapping that stays keeps its state and its backoff
async function listMappings(region, name) {
  const answer = await expectOk(
    lambdaRequest(region, 'GET', `${MAPPINGS}?FunctionName=${encodeURIComponent(name)}`),
    'ListEventSourceMappings'
  );
  return answer.EventSourceMappings ?? [];
}

async function reconcileMappings(region, name, queues) {
  const wanted = new Set(queues.map(queueArn));
  const existing = await listMappings(region, name);
  for (const mapping of existing) {
    if (wanted.has(mapping.EventSourceArn)) wanted.delete(mapping.EventSourceArn);
    else await deleteMapping(region, mapping.UUID);
  }
  for (const arn of wanted) {
    await expectOk(
      lambdaRequest(region, 'POST', MAPPINGS, {
        FunctionName: name,
        EventSourceArn: arn,
        BatchSize: BATCH_SIZE
      }),
      'CreateEventSourceMapping'
    );
  }
}

const deleteMapping = (region, uuid) =>
  expectOk(lambdaRequest(region, 'DELETE', `${MAPPINGS}${uuid}`), 'DeleteEventSourceMapping');

// config carries the service-specific create-time settings a node's definition sends
// (queue attributes, table key schema); everything else gets a teachable default
export async function provision(region, service, name, config = {}) {
  const run = PROVISION[service];
  if (!run) throw new Error(`unknown service ${service}`);
  return run(region, name, config);
}

// One LambdaFunctionConfiguration per function; an empty list clears. The ARN's region and
// account are what the emulator validates the destination against, and the function need
// not exist yet: the bucket's update and the function's deploy run in either order
async function putBucketNotifications(region, bucket, functions) {
  const configurations = functions.map(
    ({ id, functionName }) =>
      `<CloudFunctionConfiguration><Id>${escapeXml(id)}</Id>` +
      `<CloudFunction>${arn('lambda', `function:${escapeXml(functionName)}`)}</CloudFunction>` +
      NOTIFIED_EVENTS +
      '</CloudFunctionConfiguration>'
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
    jsonApi(region, 'dynamodb', 'DynamoDB_20120810.DeleteTable', { TableName: name }),

  // Deleting a function leaves its mappings behind in the emulator, polling a function that
  // is gone, so they go first
  lambda: async (region, name) => {
    await reconcileMappings(region, name, []);
    await lambdaRequest(region, 'DELETE', `${FUNCTIONS}/${name}`);
  }
};

export async function deprovision(region, service, name) {
  const run = DEPROVISION[service];
  if (!run) throw new Error(`unknown service ${service}`);
  return run(region, name);
}
