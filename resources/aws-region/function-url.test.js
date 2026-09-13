import { describe, expect, it } from 'vitest';
import { functionUrl, httpEvent, urlResponse } from './function-url.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const request = (overrides = {}) => ({
  method: 'GET',
  path: '/hello?name=Ann&x=1',
  headers: { host: 'localhost:4100', 'user-agent': 'curl' },
  body: new Uint8Array(),
  ...overrides
});

// Answers every dispatch with one reply and records what it was asked
function fakeRegion(reply) {
  const calls = [];
  return {
    calls,
    dispatch(sent) {
      calls.push({ ...sent, body: decoder.decode(sent.body) });
      return Promise.resolve({
        status: reply.status ?? 200,
        headers: reply.headers ?? {},
        body: encoder.encode(reply.body ?? '')
      });
    }
  };
}

const bodyOf = (response) => decoder.decode(response.body);

describe('httpEvent', () => {
  it('is the version 2.0 payload a function URL sends', () => {
    const event = httpEvent(request({ method: 'POST', body: encoder.encode('{"a":1}') }));
    expect(event).toMatchObject({
      version: '2.0',
      routeKey: '$default',
      rawPath: '/hello',
      rawQueryString: 'name=Ann&x=1',
      queryStringParameters: { name: 'Ann', x: '1' },
      headers: { host: 'localhost:4100', 'user-agent': 'curl' },
      requestContext: { http: { method: 'POST', path: '/hello', userAgent: 'curl' } },
      body: '{"a":1}',
      isBase64Encoded: false
    });
    expect(httpEvent(request()).body).toBeUndefined();
  });
});

describe('urlResponse', () => {
  it('sends a string as text, a response object as it says, and anything else as JSON', () => {
    const text = urlResponse('hi');
    expect([text.status, text.headers['content-type'], bodyOf(text)]).toEqual([200, 'text/plain', 'hi']);

    const shaped = urlResponse({ statusCode: 201, headers: { 'x-a': '1' }, body: { ok: true } });
    expect(shaped.status).toBe(201);
    expect(shaped.headers).toEqual({ 'content-type': 'application/json', 'x-a': '1' });
    expect(bodyOf(shaped)).toBe('{"ok":true}');

    const encoded = urlResponse({ body: Buffer.from('raw').toString('base64'), isBase64Encoded: true });
    expect(bodyOf(encoded)).toBe('raw');

    expect(bodyOf(urlResponse({ n: 1 }))).toBe('{"n":1}');
    expect(bodyOf(urlResponse(undefined))).toBe('null');
  });
});

describe('functionUrl', () => {
  it('invokes the function with the event, signed as the region, and answers with its result', async () => {
    const region = fakeRegion({ body: '{"statusCode":200,"body":"hello Ann"}' });
    const response = await functionUrl(region, 'greet').dispatch(request());
    expect(region.calls[0]).toMatchObject({
      method: 'POST',
      path: '/2015-03-31/functions/greet/invocations',
      headers: { authorization: expect.stringContaining('GGINTERNAL') }
    });
    expect(JSON.parse(region.calls[0].body)).toMatchObject({ rawPath: '/hello' });
    expect([response.status, bodyOf(response)]).toEqual([200, 'hello Ann']);
  });

  it('answers 502 with the error for a handler that threw', async () => {
    const region = fakeRegion({
      headers: { 'x-amz-function-error': 'Unhandled' },
      body: '{"errorType":"Error","errorMessage":"boom"}'
    });
    const response = await functionUrl(region, 'greet').dispatch(request());
    expect(response.status).toBe(502);
    expect(JSON.parse(bodyOf(response))).toEqual({
      message: 'Internal Server Error',
      errorType: 'Error',
      errorMessage: 'boom'
    });
  });

  it('passes a throttle through as 429, and says a missing function is not deployed', async () => {
    const throttled = await functionUrl(fakeRegion({ status: 429, body: '{"message":"Rate Exceeded"}' }), 'greet').dispatch(request());
    expect([throttled.status, JSON.parse(bodyOf(throttled)).message]).toEqual([429, 'Rate Exceeded']);
    const missing = await functionUrl(fakeRegion({ status: 404, body: '{}' }), 'greet').dispatch(request());
    expect(missing.status).toBe(503);
    expect(JSON.parse(bodyOf(missing)).message).toContain('not deployed');
  });
});
