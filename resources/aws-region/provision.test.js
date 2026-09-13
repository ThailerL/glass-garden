import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deprovision, provision } from './provision.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// A dispatcher that records every call and answers from a queue of replies, so a test says
// what the emulator would have said and then asserts on what it was asked
function fakeRegion(replies = []) {
  const calls = [];
  return {
    calls,
    dispatch(request) {
      calls.push({
        ...request,
        target: request.headers['x-amz-target'],
        body: request.body === undefined ? undefined : decoder.decode(request.body)
      });
      const reply = replies.shift() ?? { status: 200, body: '' };
      return Promise.resolve({
        status: reply.status ?? 200,
        headers: {},
        body: encoder.encode(reply.body ?? '')
      });
    }
  };
}

const listing = (...keys) =>
  '<ListBucketResult>' +
  keys.map((key) => `<Contents><Key>${key}</Key><Size>2</Size></Contents>`).join('') +
  '</ListBucketResult>';

describe('provision', () => {
  it('creates a bucket and treats an existing one as done', async () => {
    const region = fakeRegion([{ status: 409 }]);
    expect(await provision(region, 's3', 'photos')).toEqual({ bucket: 'photos' });
    expect(region.calls).toEqual([expect.objectContaining({ method: 'PUT', path: '/photos' })]);
  });

  it('leaves the notification configuration alone when the config does not mention it', async () => {
    const region = fakeRegion();
    await provision(region, 's3', 'photos', { attributes: {} });
    expect(region.calls).toHaveLength(1);
  });

  it('names every notified function by ARN, and escapes what it interpolates', async () => {
    const region = fakeRegion([{ status: 200 }, { status: 200 }]);
    await provision(region, 's3', 'photos', {
      notifications: [{ id: 'a&b', functionName: 'resize' }]
    });
    const [, configured] = region.calls;
    expect(configured.path).toBe('/photos?notification');
    expect(configured.body).toContain('<Id>a&#38;b</Id>');
    expect(configured.body).toContain(
      '<CloudFunction>arn:aws:lambda:us-east-1:000000000000:function:resize</CloudFunction>'
    );
    expect(configured.body).toContain('<Event>s3:ObjectCreated:*</Event>');
  });

  it('clears the notification configuration when nothing is connected', async () => {
    const region = fakeRegion([{ status: 200 }, { status: 200 }]);
    await provision(region, 's3', 'photos', { notifications: [] });
    expect(region.calls[1].body).not.toContain('<CloudFunctionConfiguration>');
  });

  it('creates a queue bare, then applies its attributes', async () => {
    const region = fakeRegion([
      { body: JSON.stringify({ QueueUrl: 'http://localhost:52700/000000000000/orders' }) },
      { body: '{}' }
    ]);
    const result = await provision(region, 'sqs', 'orders', {
      attributes: { VisibilityTimeout: 45 }
    });
    expect(result).toEqual({ queueUrl: 'http://localhost:52700/000000000000/orders' });
    expect(region.calls.map((call) => call.target)).toEqual([
      'AmazonSQS.CreateQueue',
      'AmazonSQS.SetQueueAttributes'
    ]);
    // Every attribute goes out as a string, whatever the config form held it as
    expect(JSON.parse(region.calls[1].body).Attributes).toEqual({ VisibilityTimeout: '45' });
  });

  it('does not call SetQueueAttributes when there is nothing to set', async () => {
    const region = fakeRegion([{ body: JSON.stringify({ QueueUrl: 'u' }) }]);
    await provision(region, 'sqs', 'orders');
    expect(region.calls).toHaveLength(1);
  });

  it('reports a failed CreateQueue', async () => {
    const region = fakeRegion([{ status: 400, body: JSON.stringify({ message: 'bad name' }) }]);
    await expect(provision(region, 'sqs', 'Orders!')).rejects.toThrow(/CreateQueue failed.*bad name/);
  });

  it('gives a table a default key schema, and accepts one it already has', async () => {
    const region = fakeRegion([
      { status: 400, body: JSON.stringify({ __type: 'com.amazon#ResourceInUseException' }) }
    ]);
    expect(await provision(region, 'dynamodb', 'notes')).toEqual({ table: 'notes' });
    expect(JSON.parse(region.calls[0].body)).toMatchObject({
      TableName: 'notes',
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST'
    });
  });

  it('refuses a service it does not provision', async () => {
    await expect(provision(fakeRegion(), 'sns', 'alerts')).rejects.toThrow('unknown service');
  });
});

// A node directory holding one handler, for the deploys below
function functionDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-fn-'));
  fs.writeFileSync(path.join(directory, 'index.mjs'), 'export const handler = async () => 1;\n');
  return directory;
}

const functionConfig = (directory, extra = {}) => ({
  directory,
  env: { A: '1' },
  timeout: 3,
  maxConcurrency: 5,
  queues: [],
  ...extra
});

const json = (value) => ({ body: JSON.stringify(value) });
const mappings = (...arns) =>
  json({ EventSourceMappings: arns.map((arn, i) => ({ UUID: `m${i}`, EventSourceArn: arn })) });

describe('provision lambda', () => {
  it('creates a function that is not there from the directory, then sets its concurrency', async () => {
    const directory = functionDirectory();
    const region = fakeRegion([{ status: 404, body: '{}' }, { status: 201, body: '{}' }, json({}), mappings()]);
    const result = await provision(region, 'lambda', 'greet', functionConfig(directory));
    expect(region.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /2015-03-31/functions/greet',
      'POST /2015-03-31/functions',
      'PUT /2015-03-31/functions/greet/concurrency',
      'GET /2015-03-31/event-source-mappings/?FunctionName=greet'
    ]);
    const created = JSON.parse(region.calls[1].body);
    expect(created).toMatchObject({
      FunctionName: 'greet',
      Runtime: 'nodejs22.x',
      Handler: 'index.handler',
      Timeout: 3,
      Environment: { Variables: { A: '1' } }
    });
    // The package is a real zip of the directory, and the hash is what the emulator will hold
    expect(Buffer.from(created.Code.ZipFile, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04])
    );
    expect(result).toEqual({ functionName: 'greet', codeSha256: expect.stringMatching(/=$/) });
    expect(JSON.parse(region.calls[2].body)).toEqual({ ReservedConcurrentExecutions: 5 });
  });

  it('sends only what changed to a function that exists', async () => {
    const directory = functionDirectory();
    const first = fakeRegion([{ status: 404, body: '{}' }, { status: 201, body: '{}' }, json({}), mappings()]);
    const { codeSha256 } = await provision(first, 'lambda', 'greet', functionConfig(directory));

    // Same code, settings and concurrency: nothing is sent but the look-ups
    const unchanged = fakeRegion([
      json({
        Configuration: { CodeSha256: codeSha256, Timeout: 3, Environment: { Variables: { A: '1' } } },
        Concurrency: { ReservedConcurrentExecutions: 5 }
      }),
      mappings()
    ]);
    await provision(unchanged, 'lambda', 'greet', functionConfig(directory));
    expect(unchanged.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /2015-03-31/functions/greet',
      'GET /2015-03-31/event-source-mappings/?FunctionName=greet'
    ]);

    // A saved edit: new code, same configuration
    fs.writeFileSync(path.join(directory, 'index.mjs'), 'export const handler = async () => 2;\n');
    const edited = fakeRegion([
      json({ Configuration: { CodeSha256: codeSha256, Timeout: 3, Environment: { Variables: { A: '1' } } } }),
      json({}),
      json({}),
      mappings()
    ]);
    await provision(edited, 'lambda', 'greet', functionConfig(directory));
    expect(edited.calls[1]).toMatchObject({ method: 'PUT', path: '/2015-03-31/functions/greet/code' });

    // A raised timeout: same code, new configuration
    const retimed = fakeRegion([
      json({ Configuration: { CodeSha256: 'stale', Timeout: 3, Environment: { Variables: { A: '1' } } } }),
      json({}),
      json({}),
      json({}),
      mappings()
    ]);
    await provision(retimed, 'lambda', 'greet', functionConfig(directory, { timeout: 30 }));
    expect(JSON.parse(retimed.calls[2].body)).toEqual({
      Timeout: 30,
      Environment: { Variables: { A: '1' } }
    });
  });

  it('adds and removes event source mappings to match the queues pointing at it', async () => {
    const directory = functionDirectory();
    // Code stale, configuration unchanged: an upload, the concurrency, then the mappings
    const region = fakeRegion([
      json({ Configuration: { CodeSha256: 'stale', Timeout: 3, Environment: { Variables: { A: '1' } } } }),
      json({}),
      json({}),
      mappings('arn:aws:sqs:us-east-1:000000000000:orders', 'arn:aws:sqs:us-east-1:000000000000:old'),
      { status: 204 },
      { status: 202, body: '{}' }
    ]);
    await provision(region, 'lambda', 'greet', functionConfig(directory, { queues: ['orders', 'new'] }));
    const tail = region.calls.slice(-3);
    expect(tail.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /2015-03-31/event-source-mappings/?FunctionName=greet',
      'DELETE /2015-03-31/event-source-mappings/m1',
      'POST /2015-03-31/event-source-mappings/'
    ]);
    expect(JSON.parse(tail[2].body)).toEqual({
      FunctionName: 'greet',
      EventSourceArn: 'arn:aws:sqs:us-east-1:000000000000:new',
      BatchSize: 10
    });
  });

  it('reports a failed create', async () => {
    const region = fakeRegion([
      { status: 404, body: '{}' },
      { status: 400, body: JSON.stringify({ message: 'bad runtime' }) }
    ]);
    await expect(provision(region, 'lambda', 'greet', functionConfig(functionDirectory()))).rejects.toThrow(
      /CreateFunction failed.*bad runtime/
    );
  });
});

describe('deprovision', () => {
  it('empties a bucket page by page before deleting it', async () => {
    const region = fakeRegion([
      { body: listing('a.txt', 'holiday/b c.txt') },
      { status: 204 },
      { status: 204 },
      { body: listing() },
      { status: 204 }
    ]);
    await deprovision(region, 's3', 'photos');
    expect(region.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /photos?list-type=2',
      'DELETE /photos/a.txt',
      // The slash is the key's own structure; the space is not
      'DELETE /photos/holiday/b%20c.txt',
      'GET /photos?list-type=2',
      'DELETE /photos'
    ]);
  });

  it('does nothing for a bucket that is not there', async () => {
    const region = fakeRegion([{ status: 404 }]);
    await deprovision(region, 's3', 'gone');
    expect(region.calls).toHaveLength(1);
  });

  it('looks a queue up before deleting it, and stops if it is gone', async () => {
    const region = fakeRegion([{ status: 400, body: '{}' }]);
    await deprovision(region, 'sqs', 'orders');
    expect(region.calls.map((call) => call.target)).toEqual(['AmazonSQS.GetQueueUrl']);
  });

  it("deletes a function's mappings before the function", async () => {
    const region = fakeRegion([mappings('arn:aws:sqs:us-east-1:000000000000:orders'), { status: 204 }, { status: 204 }]);
    await deprovision(region, 'lambda', 'greet');
    expect(region.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /2015-03-31/event-source-mappings/?FunctionName=greet',
      'DELETE /2015-03-31/event-source-mappings/m0',
      'DELETE /2015-03-31/functions/greet'
    ]);
  });
});
