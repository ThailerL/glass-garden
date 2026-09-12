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

  it('names every notified queue by ARN, and escapes what it interpolates', async () => {
    const region = fakeRegion([{ status: 200 }, { status: 200 }]);
    await provision(region, 's3', 'photos', {
      notifications: [{ id: 'a&b', queueName: 'gg-notify-a' }]
    });
    const [, configured] = region.calls;
    expect(configured.path).toBe('/photos?notification');
    expect(configured.body).toContain('<Id>a&#38;b</Id>');
    expect(configured.body).toContain(
      '<Queue>arn:aws:sqs:us-east-1:000000000000:gg-notify-a</Queue>'
    );
    expect(configured.body).toContain('<Event>s3:ObjectCreated:*</Event>');
  });

  it('clears the notification configuration when nothing is connected', async () => {
    const region = fakeRegion([{ status: 200 }, { status: 200 }]);
    await provision(region, 's3', 'photos', { notifications: [] });
    expect(region.calls[1].body).not.toContain('<QueueConfiguration>');
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
    await expect(provision(fakeRegion(), 'lambda', 'greet')).rejects.toThrow('unknown service');
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
});
