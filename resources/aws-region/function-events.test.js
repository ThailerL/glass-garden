import { describe, expect, it } from 'vitest';
import { invocationSource } from './function-events.js';

describe('invocationSource', () => {
  it('names the queue behind a batch, and counts its records', () => {
    const event = JSON.stringify({
      Records: [
        { eventSource: 'aws:sqs', eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:orders' },
        { eventSource: 'aws:sqs', eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:orders' }
      ]
    });
    expect(invocationSource(event)).toEqual({ service: 'sqs', name: 'orders', count: 2 });
  });

  it('names the bucket behind a notification', () => {
    const event = JSON.stringify({
      Records: [{ eventSource: 'aws:s3', s3: { bucket: { name: 'uploads' }, object: { key: 'a' } } }]
    });
    expect(invocationSource(event)).toEqual({ service: 's3', name: 'uploads', count: 1 });
  });

  it('sees no source in what a caller sent, whatever its shape', () => {
    expect(invocationSource('{"hello":"world"}')).toBeUndefined();
    expect(invocationSource('{"Records":[]}')).toBeUndefined();
    expect(invocationSource('{"Records":[{"eventSource":"aws:sqs"}]}')).toBeUndefined();
    expect(invocationSource('not json')).toBeUndefined();
    expect(invocationSource('null')).toBeUndefined();
  });
});
