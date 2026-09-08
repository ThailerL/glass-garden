// Pure decision logic for the region bridge: who is calling, what they may touch, and
// what a denial should say. No VM dependencies, so the host test suite imports it.
// Callers are principals, not any particular resource kind: a principal carries its own
// display name and the resource names its edges grant, per service.

const NODE_LABELS = { s3: 'Bucket', sqs: 'Queue', dynamodb: 'Table' };
const noun = (service) => NODE_LABELS[service].toLowerCase();

// The stdout line prefix for events the bridge reports and the host routes
export const EVENT_PREFIX = 'gg:event ';

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// The messages a ReceiveMessage answer carried
export function receivedMessages(responseText) {
  return parseJson(responseText)?.Messages ?? [];
}

// The hidden queue a bucket's notifications reach a function through, named for the
// function and owned by no node
const NOTIFICATION_QUEUE_PREFIX = 'gg-notifications-';
export const notificationQueueName = (nodeId) => NOTIFICATION_QUEUE_PREFIX + nodeId;
export const isNotificationQueue = (name) => name.startsWith(NOTIFICATION_QUEUE_PREFIX);

// The bucket behind each S3 notification; S3's test event names none and is skipped
export function notifiedBuckets(messages) {
  return messages.flatMap((message) => {
    const bucket = parseJson(message.Body)?.Records?.[0]?.s3?.bucket?.name;
    return bucket ? [bucket] : [];
  });
}

// What every holder of a topology starts from, before the canvas has said anything
export function emptyTopology() {
  return { principals: {}, owners: { s3: {}, sqs: {}, dynamodb: {} } };
}

// SigV4 credential scope: "AWS4-HMAC-SHA256 Credential=<key>/<date>/<region>/<service>/aws4_request, ..."
// The emulator routes by the service in this scope, so enforcement keys on the same signal
export function parseCredential(authorization) {
  const match = /Credential=([^/,\s]+)\/\d{8}\/([^/]+)\/([^/]+)\/aws4_request/.exec(
    authorization ?? '',
  );
  if (!match) return undefined;
  return { accessKeyId: match[1], region: match[2], service: match[3] };
}

// Path-style addressing only (the documented client contract is forcePathStyle: true)
export function bucketFromPath(path) {
  const bucket = path.split('/')[1]?.split('?')[0];
  return bucket ? decodeURIComponent(bucket) : undefined;
}

// Every resource a request touches. S3 names its bucket in the path, and a copy names a
// second one in a header - both must be granted, as S3 itself requires. The JSON protocols
// are read by convention rather than per operation, so a new operation needs no code here.
// A body that does not parse yields nothing, falling back to service-level enforcement so a
// malformed request still gets the emulator's own error
export function extractResourceNames(service, path, bodyText, headers = {}) {
  if (service === 's3') {
    const copySource = headers['x-amz-copy-source'];
    const source = copySource ? bucketFromPath(`/${copySource.replace(/^\/+/, '')}`) : undefined;
    return [bucketFromPath(path), source].filter((name) => name !== undefined);
  }
  if (service !== 'sqs' && service !== 'dynamodb') return [];
  const parsed = bodyText ? parseJson(bodyText) : undefined;
  if (!parsed || typeof parsed !== 'object') return [];
  if (service === 'dynamodb') {
    // The batch operations name their tables in RequestItems, the transact ones per item
    return unique([...requestItemTables(parsed), ...stringsAt(parsed, 'TableName')]);
  }
  return unique([
    ...stringsAt(parsed, 'QueueName'),
    ...stringsAt(parsed, 'QueueUrl').map(queueNameFromUrl),
    ...attributeQueueArns(parsed),
  ]).filter((name) => name !== undefined);
}

const unique = (names) => [...new Set(names)];

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// Own keys before nested ones, so the resource a request is addressed to stays first
function stringsAt(value, key, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) stringsAt(item, key, found);
  } else if (isRecord(value)) {
    if (typeof value[key] === 'string') found.push(value[key]);
    for (const item of Object.values(value)) stringsAt(item, key, found);
  }
  return found;
}

const queueNameFromUrl = (url) => url.replace(/\/+$/, '').split('/').pop() || undefined;

const requestItemTables = (parsed) =>
  isRecord(parsed.RequestItems) ? Object.keys(parsed.RequestItems) : [];

// A RedrivePolicy names its dead letter queue by ARN inside an attribute value
const QUEUE_ARN = /arn:aws:sqs:[^:]*:[^:]*:([^"\s,}]+)/g;
const attributeQueueArns = (parsed) =>
  isRecord(parsed.Attributes)
    ? Object.values(parsed.Attributes)
        .filter((value) => typeof value === 'string')
        .flatMap((value) => [...value.matchAll(QUEUE_ARN)].map((match) => match[1]))
    : [];

// nodeId names the caller once the principal is known, so denials can be routed to
// that node's log
const deny = (status, code, message, nodeId) => ({ allow: false, status, code, message, nodeId });

// topology: { principals: { [accessKeyId]: Principal } } where a principal is
// { nodeId, name, resources: { s3: string[], sqs: string[], dynamodb: string[] } }.
// The checks run most-general first so the signpost names the closest missing thing:
// bad credentials, unknown service, unknown caller, no edge to the family, no edge to the
// named resource
export function decideRequest({ credential, resourceNames }, topology) {
  if (!credential) {
    return deny(
      403,
      'AccessDenied',
      'This request carries no AWS credentials. Use the AWS SDK with the environment variables provided to your code.',
    );
  }

  const { service, accessKeyId } = credential;
  if (!NODE_LABELS[service]) {
    return deny(
      400,
      'UnsupportedService',
      `Glass Garden does not emulate ${service}. Buckets (S3), queues (SQS) and tables (DynamoDB) are available.`,
    );
  }

  const principal = topology.principals[accessKeyId];
  if (!principal) {
    return deny(
      403,
      'InvalidAccessKeyId',
      'These credentials do not belong to any resource on the canvas. Use the AWS environment variables provided to your code.',
    );
  }

  // A node earns access by drawing an edge; the admin, which is not a node, holds every
  // resource on the canvas, so what it lacks is the node itself
  const label = NODE_LABELS[service];
  const denyAccess = (asNode, asAdmin) =>
    deny(403, 'AccessDenied', principal.nodeId ? asNode : asAdmin, principal.nodeId);
  const allowed = principal.resources[service] ?? [];
  if (allowed.length === 0) {
    return denyAccess(
      `"${principal.name}" is not connected to a ${label} node. Draw an edge to use ${service}.`,
      `There is no ${label} node on the canvas. Add one to use ${service}.`,
    );
  }
  const missing = resourceNames.find((name) => !allowed.includes(name));
  if (missing !== undefined) {
    return denyAccess(
      `"${principal.name}" is not connected to the ${noun(service)} "${missing}". Draw an edge to that ${label} node to use it.`,
      `There is no ${noun(service)} "${missing}" on the canvas. Add a ${label} node with that name to use it.`,
    );
  }

  return { allow: true };
}

const escapeXml = (text) => text.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

// S3 speaks XML errors; SQS and DynamoDB speak the JSON protocols
export function denialResponse(service, denial) {
  if (service === 's3') {
    return {
      status: denial.status,
      contentType: 'application/xml',
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${denial.code}</Code><Message>${escapeXml(denial.message)}</Message></Error>`,
    };
  }
  return {
    status: denial.status,
    contentType: 'application/x-amz-json-1.0',
    body: JSON.stringify({ __type: denial.code, message: denial.message }),
  };
}
