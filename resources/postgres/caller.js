// Each consumer connects as its own Postgres user, named for its node, the way separate apps
// get separate roles on a real server. PGlite trusts any name, so this is identity for the
// canvas rather than access control
const CALLER_PREFIX = 'gg';
const PROTOCOL_3 = 196608;
// A simple query, and the bind that runs a prepared one: either is one query. Char codes
// rather than a Buffer because the canvas imports this module for callerUser, so nothing at
// module scope may touch a Node built-in
const QUERY_TYPES = [...'QB'].map((type) => type.charCodeAt(0));

export const callerUser = (nodeId) => CALLER_PREFIX + nodeId;

// Who opened a connection, from the startup packet's key\0value\0 pairs: values sit at the
// odd indices, each after its key
export function nodeInStartup(payload) {
  const parts = payload.toString('utf8').split('\0');
  const user = parts.find((_, i) => i % 2 === 1 && parts[i - 1] === 'user') ?? '';
  return user.startsWith(CALLER_PREFIX) ? user.slice(CALLER_PREFIX.length) : undefined;
}

// Frames a copy of what one client sends, so a query can be reported as it is asked for. This
// only watches bytes on their way to the server, so a slip loses a dot rather than a query
export function connectionTap(onQuery) {
  let carry = Buffer.alloc(0);
  let node;
  let greeted = false;
  return (chunk) => {
    try {
      carry = Buffer.concat([carry, chunk]);
      // Until the startup packet lands, messages carry a length and no type byte. SSL and
      // cancel requests are shaped the same way and are consumed without ending the greeting
      while (!greeted && carry.length >= 8) {
        const length = carry.readInt32BE(0);
        if (length < 8 || carry.length < length) return;
        if (carry.readInt32BE(4) === PROTOCOL_3) {
          node = nodeInStartup(carry.subarray(8, length));
          greeted = true;
        }
        carry = carry.subarray(length);
      }
      while (greeted && carry.length >= 5) {
        const length = 1 + carry.readInt32BE(1);
        if (length < 5 || carry.length < length) return;
        if (node !== undefined && QUERY_TYPES.includes(carry[0])) onQuery(node);
        carry = carry.subarray(length);
      }
    } catch {
      carry = Buffer.alloc(0);
    }
  };
}
