import { describe, expect, it } from 'vitest';
import { callerUser, connectionTap, nodeInStartup } from './caller.js';

const startup = (user) => {
  const params = Buffer.from(`user\0${user}\0database\0postgres\0\0`, 'utf8');
  const packet = Buffer.alloc(8 + params.length);
  packet.writeInt32BE(packet.length, 0);
  packet.writeInt32BE(196608, 4);
  params.copy(packet, 8);
  return packet;
};

const message = (type, body = '') => {
  const payload = Buffer.from(`${body}\0`, 'utf8');
  const packet = Buffer.alloc(5 + payload.length);
  packet.write(type, 0, 'ascii');
  packet.writeInt32BE(4 + payload.length, 1);
  payload.copy(packet, 5);
  return packet;
};

describe('nodeInStartup', () => {
  it('reads the node back out of the user the canvas handed the consumer', () => {
    expect(nodeInStartup(startup(callerUser('n7GM-J2_4')).subarray(8))).toBe('n7GM-J2_4');
  });

  it('names no node for another client, or for a packet without a user', () => {
    expect(nodeInStartup(startup('postgres').subarray(8))).toBeUndefined();
    expect(nodeInStartup(Buffer.from('database\0postgres\0\0'))).toBeUndefined();
  });
});

describe('connectionTap', () => {
  const tapping = () => {
    const seen = [];
    return { seen, feed: connectionTap((node) => seen.push(node)) };
  };

  it('reports one query per simple query and per bind, naming the caller', () => {
    const { seen, feed } = tapping();
    feed(startup(callerUser('web')));
    feed(message('Q', 'select 1'));
    feed(Buffer.concat([message('P', 'select $1'), message('B'), message('E')]));
    expect(seen).toEqual(['web', 'web']);
  });

  it('reassembles a query split across chunks, and one split from its own header', () => {
    const { seen, feed } = tapping();
    feed(startup(callerUser('web')));
    const query = message('Q', 'select 1');
    feed(query.subarray(0, 3));
    feed(query.subarray(3, 7));
    feed(query.subarray(7));
    expect(seen).toEqual(['web']);
  });

  it('waits for a startup packet that arrives in pieces, after an SSL request', () => {
    const { seen, feed } = tapping();
    const ssl = Buffer.alloc(8);
    ssl.writeInt32BE(8, 0);
    ssl.writeInt32BE(80877103, 4);
    const packet = startup(callerUser('web'));
    feed(Buffer.concat([ssl, packet.subarray(0, 6)]));
    feed(packet.subarray(6));
    feed(message('Q', 'select 1'));
    expect(seen).toEqual(['web']);
  });

  it('reports nothing for a client that did not connect as a node', () => {
    const { seen, feed } = tapping();
    feed(startup('postgres'));
    feed(message('Q', 'select 1'));
    expect(seen).toEqual([]);
  });

  it('never lets a query text be read as a message header', () => {
    const { seen, feed } = tapping();
    feed(startup(callerUser('web')));
    // 'Q' and 'B' inside the text are payload, not the start of another message
    feed(message('Q', "select 'QBQB' as noise"));
    expect(seen).toEqual(['web']);
  });
});
