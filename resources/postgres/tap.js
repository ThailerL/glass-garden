const PROTOCOL_3 = 196608;
// A simple query, and the bind that runs a prepared one: either is one query. Char codes
// rather than a Buffer because the canvas imports this module for RESET_MARKER, so nothing at
// module scope may touch a Node built-in
const QUERY_TYPES = [...'QB'].map((type) => type.charCodeAt(0));

// Left in the node's directory by the canvas, read by server.js as it starts. Shared from here
// because a typo in either copy would turn the reset into a silent no-op
export const RESET_MARKER = 'reset-on-start';

// Taps only once the owner listens, so our listener never starts the flow early
export function tapAlongside(socket, tap) {
  function onNewListener(event) {
    if (event !== 'data') return;
    socket.off('newListener', onNewListener);
    socket.on('data', tap);
  }
  socket.on('newListener', onNewListener);
}

// Frames a copy of what one client sends, so a query can be reported as it is asked for. This
// only watches bytes on their way to the server, so a slip loses a dot rather than a query
export function connectionTap(onQuery) {
  let carry = Buffer.alloc(0);
  let greeted = false;
  return (chunk) => {
    try {
      carry = Buffer.concat([carry, chunk]);
      // Until the startup packet lands, messages carry a length and no type byte. SSL and
      // cancel requests are shaped the same way and are consumed without ending the greeting
      while (!greeted && carry.length >= 8) {
        const length = carry.readInt32BE(0);
        if (length < 8 || carry.length < length) return;
        greeted = carry.readInt32BE(4) === PROTOCOL_3;
        carry = carry.subarray(length);
      }
      while (greeted && carry.length >= 5) {
        const length = 1 + carry.readInt32BE(1);
        if (length < 5 || carry.length < length) return;
        if (QUERY_TYPES.includes(carry[0])) onQuery();
        carry = carry.subarray(length);
      }
    } catch {
      carry = Buffer.alloc(0);
    }
  };
}
