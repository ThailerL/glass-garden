export const EVENT_PREFIX = 'gg:event ';

// Embedded Metric Format, a metric always with the same dimensions. `fold`: its lines sum to a
// total worth drawing. `value` may be a second's readings as one array, since the host parses each line
export function putMetric(name, value, unit, dimensions = {}, fold = true) {
  const named = Object.keys(dimensions);
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'glass-garden',
            Dimensions: named.length === 0 ? [[]] : fold ? [[], named] : [named],
            Metrics: [{ Name: name, Unit: unit }]
          }
        ]
      },
      [name]: value,
      ...dimensions
    })
  );
}

export function reportEvent(kind, fields) {
  console.log(EVENT_PREFIX + JSON.stringify({ kind, at: Date.now(), ...fields }));
}

export async function bodyOf(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
