// What an invocation's event says about where it came from. A queue batch and a bucket
// notification both reach the function inside the emulator, so nothing crosses the front
// door for the bridge to see; the event is the only witness. Records name their source the
// way Lambda's do
import { parseJson } from './lib.js';

// { service, name, count } for a triggered invocation, undefined for one a caller sent.
// Looked for before parsing: a function URL's event carries the whole request body
export function invocationSource(eventText) {
  if (!eventText.includes('"Records"')) return undefined;
  const records = parseJson(eventText)?.Records;
  if (!Array.isArray(records) || records.length === 0) return undefined;
  const [record] = records;
  if (record?.eventSource === 'aws:sqs') {
    const name = String(record.eventSourceARN ?? '').split(':').pop();
    return name ? { service: 'sqs', name, count: records.length } : undefined;
  }
  if (record?.eventSource === 'aws:s3') {
    const name = record.s3?.bucket?.name;
    return typeof name === 'string' && name ? { service: 's3', name, count: 1 } : undefined;
  }
  return undefined;
}
