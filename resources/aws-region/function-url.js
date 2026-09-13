// A function URL, served by the region on the function node's own port so the load
// balancer and the Preview tab reach it like any instance. A request becomes the event a
// Lambda function URL sends, in its version 2.0 shape; the handler's result becomes the
// response by the URL's own rules. The invoke is internal: the region is the Lambda
// service here, not a caller the ladder judges or a hop the canvas draws
import { lambdaRequest } from './aws-api.js';

const INVOCATIONS = (name) => `/2015-03-31/functions/${encodeURIComponent(name)}/invocations`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function httpEvent({ method, path, headers, body }) {
  const url = new URL(path, 'http://localhost');
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers,
    queryStringParameters: Object.fromEntries(url.searchParams),
    requestContext: {
      http: {
        method,
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: headers['user-agent'] ?? ''
      },
      timeEpoch: Date.now()
    },
    body: body && body.length > 0 ? decoder.decode(body) : undefined,
    isBase64Encoded: false
  };
}

const respond = (status, headers, text) => ({
  status,
  headers,
  body: typeof text === 'string' ? encoder.encode(text) : text
});
const json = (status, value) =>
  respond(status, { 'content-type': 'application/json' }, JSON.stringify(value));

// A function URL's response rules: a string is sent as text, an object carrying statusCode
// or body is a response, anything else is sent as JSON
export function urlResponse(result) {
  if (typeof result === 'string') return respond(200, { 'content-type': 'text/plain' }, result);
  if (result && typeof result === 'object' && ('statusCode' in result || 'body' in result)) {
    const { statusCode = 200, headers = {}, body = '', isBase64Encoded = false } = result;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return respond(
      statusCode,
      { 'content-type': 'application/json', ...headers },
      isBase64Encoded ? Buffer.from(text, 'base64') : text
    );
  }
  return json(200, result ?? null);
}

// What a function URL answers for one function: the dispatcher pocket-region's serve takes
export function functionUrl(region, functionName) {
  return {
    async dispatch(request) {
      const [status, answer, headers] = await lambdaRequest(
        region,
        'POST',
        INVOCATIONS(functionName),
        httpEvent(request)
      );
      // What a URL answers when the handler fails or the function is at its cap; the details
      // are in the function's log
      if (status === 429) return json(429, { message: answer.message ?? 'Rate exceeded' });
      if (status === 404) {
        return json(503, { message: `"${functionName}" is not deployed yet. Save its code to deploy it.` });
      }
      if (status !== 200) return json(502, { message: 'Internal Server Error', ...answer });
      if (headers['x-amz-function-error']) {
        return json(502, {
          message: 'Internal Server Error',
          errorType: answer.errorType,
          errorMessage: answer.errorMessage
        });
      }
      return urlResponse(answer);
    }
  };
}
