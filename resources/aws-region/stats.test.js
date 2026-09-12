import { describe, expect, it } from 'vitest';
import { sampleStats } from './stats.js';

const encoder = new TextEncoder();

// Answers by route rather than in order: the sampler walks the services in its own order
function fakeRegion(answer) {
  const calls = [];
  return {
    calls,
    dispatch(request) {
      calls.push(request);
      const reply = answer(request) ?? { status: 200, body: '' };
      return Promise.resolve({
        status: reply.status ?? 200,
        headers: {},
        body: encoder.encode(reply.body ?? '')
      });
    }
  };
}

const contents = (...sizes) =>
  sizes.map((size) => `<Contents><Key>k</Key><Size>${size}</Size></Contents>`).join('');

describe('sampleStats', () => {
  it('counts a bucket across every page of the listing', async () => {
    const region = fakeRegion((request) =>
      request.path.includes('continuation-token=next%2Fpage')
        ? { body: `<ListBucketResult>${contents(4)}<IsTruncated>false</IsTruncated>` }
        : {
            body:
              `<ListBucketResult>${contents(1_000_000, 2)}<IsTruncated>true</IsTruncated>` +
              '<NextContinuationToken>next/page</NextContinuationToken>'
          }
    );
    const stats = await sampleStats(region, { s3: { photos: 'n1' } });
    expect(stats.s3.photos).toEqual({ objects: [3, 'Count'], size: [1.000006, 'Megabytes'] });
    expect(region.calls).toHaveLength(2);
  });

  it('splits a queue into what is waiting and what is in flight', async () => {
    const region = fakeRegion(() => ({
      body: JSON.stringify({
        Attributes: {
          ApproximateNumberOfMessages: '7',
          ApproximateNumberOfMessagesNotVisible: '2'
        }
      })
    }));
    const stats = await sampleStats(region, { sqs: { orders: 'n2' } });
    expect(stats.sqs.orders).toEqual({ messages: [7, 'Count'], 'in flight': [2, 'Count'] });
  });

  it('reads a table item count', async () => {
    const region = fakeRegion(() => ({ body: JSON.stringify({ Table: { ItemCount: 4 } }) }));
    const stats = await sampleStats(region, { dynamodb: { notes: 'n3' } });
    expect(stats.dynamodb.notes).toEqual({ items: [4, 'Count'] });
  });

  it('leaves out a resource that has gone, and keeps the rest of the sample', async () => {
    const region = fakeRegion((request) =>
      request.path === '/gone?list-type=2' ? { status: 404 } : { body: `<r>${contents(5)}</r>` }
    );
    const stats = await sampleStats(region, { s3: { gone: 'n1', photos: 'n2' } });
    expect(stats.s3).toEqual({ photos: { objects: [1, 'Count'], size: [0.000005, 'Megabytes'] } });
  });

  it('asks about nothing when the canvas owns nothing', async () => {
    const region = fakeRegion(() => ({}));
    expect(await sampleStats(region, {})).toEqual({ s3: {}, sqs: {}, dynamodb: {} });
    expect(region.calls).toHaveLength(0);
  });
});
