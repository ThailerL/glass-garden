// Pure decision logic for the region bridge: who is calling, what they may touch, and
// what a denial should say. No VM dependencies, so the host test suite imports it.
// Callers are principals, not any particular resource kind: a principal carries its own
// display name and the resource names its edges grant, per service.

const NODE_LABELS = { s3: 'Bucket', sqs: 'Queue', dynamodb: 'Table' };
const noun = (service) => NODE_LABELS[service].toLowerCase();

// The stdout line prefix for events the bridge reports and the host routes
export const EVENT_PREFIX = 'gg:event ';

// What every holder of a topology starts from, before the canvas has said anything
export function emptyTopology() {
  return { services: [], principals: {}, owners: { s3: {}, sqs: {}, dynamodb: {} } };
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

// The JSON protocols carry the resource name at a fixed top-level key. A body that does
// not parse yields undefined, falling back to service-level enforcement so a malformed
// request still gets the emulator's own error rather than a misleading denial
export function extractResourceName(service, path, bodyText) {
  if (service === 's3') return bucketFromPath(path);
  if (service !== 'sqs' && service !== 'dynamodb') return undefined;
  if (!bodyText) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  if (service === 'dynamodb') {
    return typeof parsed.TableName === 'string' ? parsed.TableName : undefined;
  }
  if (typeof parsed.QueueName === 'string') return parsed.QueueName;
  if (typeof parsed.QueueUrl === 'string') {
    return parsed.QueueUrl.replace(/\/+$/, '').split('/').pop() || undefined;
  }
  return undefined;
}

// nodeId names the caller once the principal is known, so denials can be routed to
// that node's log
const deny = (status, code, message, nodeId) => ({ allow: false, status, code, message, nodeId });

// topology: { services: string[], principals: { [accessKeyId]: Principal } } where a
// principal is { nodeId, name, resources: { s3: string[], sqs: string[], dynamodb: string[] } }.
// The checks run most-general first so the signpost names the closest missing thing:
// bad credentials, unknown service, unknown caller, no such node family on the canvas,
// no edge to the family, no edge to the named resource
export function decideRequest({ credential, resourceName }, topology) {
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

  if (!topology.services.includes(service)) {
    return deny(
      403,
      'AccessDenied',
      `There is no ${noun(service)} on the canvas. Drag a ${NODE_LABELS[service]} node in and connect "${principal.name}" to it.`,
      principal.nodeId,
    );
  }
  const allowed = principal.resources[service] ?? [];
  if (allowed.length === 0) {
    return deny(
      403,
      'AccessDenied',
      `"${principal.name}" is not connected to a ${NODE_LABELS[service]} node. Draw an edge to use ${service}.`,
      principal.nodeId,
    );
  }
  if (resourceName !== undefined && !allowed.includes(resourceName)) {
    return deny(
      403,
      'AccessDenied',
      `"${principal.name}" is not connected to the ${noun(service)} "${resourceName}". Draw an edge to that ${NODE_LABELS[service]} node to use it.`,
      principal.nodeId,
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
