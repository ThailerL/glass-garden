// Calls the region makes for itself: provisioning and the stats sampler. They go straight
// to the emulator rather than round the socket, so they are never judged by the enforcement
// ladder and never counted as traffic the user caused.
//
// The emulator routes on the service in the SigV4 credential scope and never verifies a
// signature, so a signature-shaped header with the right scope is the whole of what it needs.

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export const textOf = (response) => decoder.decode(response.body);

function internalHeaders(service, extra) {
  return {
    host: 'localhost',
    authorization:
      'AWS4-HMAC-SHA256 Credential=GGINTERNAL/20260101/us-east-1/' +
      `${service}/aws4_request, SignedHeaders=host, Signature=internal`,
    ...extra
  };
}

export function s3Request(region, method, path, body, extraHeaders) {
  return region.dispatch({
    method,
    path,
    headers: internalHeaders('s3', extraHeaders),
    body: body === undefined ? undefined : encoder.encode(body)
  });
}

// The JSON protocol SQS and DynamoDB speak
export async function jsonApi(region, service, target, body) {
  const response = await region.dispatch({
    method: 'POST',
    path: '/',
    headers: internalHeaders(service, {
      'x-amz-target': target,
      'content-type': 'application/x-amz-json-1.0'
    }),
    body: encoder.encode(JSON.stringify(body))
  });
  const text = textOf(response);
  return [response.status, text ? JSON.parse(text) : {}];
}

// Slashes stay slashes - they are the key's own structure, not separators to escape
export const objectPath = (bucket, key) =>
  `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

// One page of a bucket listing, for the two callers that walk one: the sampler, which wants
// what each object weighs, and the drain before a delete, which wants the keys. A bucket
// that is not there reports its status rather than an empty page, which reads the same
export async function listObjectsPage(region, bucket, token) {
  const query = token === undefined ? '' : `&continuation-token=${encodeURIComponent(token)}`;
  const listing = await s3Request(region, 'GET', `/${bucket}?list-type=2${query}`);
  if (listing.status !== 200) return { status: listing.status, entries: [] };
  const text = textOf(listing);
  return {
    status: listing.status,
    entries: xmlElements(text, 'Contents'),
    nextToken: xmlText(text, 'IsTruncated') === 'true' ? xmlText(text, 'NextContinuationToken') : undefined
  };
}

// Enough of an XML reader for the shapes we ask for: repeated elements under a known parent.
// The emulator's answers are machine-generated, so there are no attributes, namespaces or
// CDATA sections to account for. One compiled regex per tag, since the sampler reads the
// same handful of tags once a second for as long as the region is up
const patterns = new Map();

function pattern(tag) {
  let compiled = patterns.get(tag);
  if (!compiled) {
    compiled = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
    patterns.set(tag, compiled);
  }
  compiled.lastIndex = 0;
  return compiled;
}

export function xmlElements(text, tag) {
  return [...text.matchAll(pattern(tag))].map((match) => match[1]);
}

export const xmlText = (element, tag) => xmlElements(element, tag)[0];

export function unescapeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
