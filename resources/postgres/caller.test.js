import { describe, expect, it } from 'vitest';
import { connectionTap } from './caller.js';

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

describe('connectionTap', () => {
  const tapping = () => {
    let queries = 0;
    const feed = connectionTap(() => queries++);
    return { queries: () => queries, feed };
  };

  it('reports one query per simple query and per bind', () => {
    const { queries, feed } = tapping();
    feed(startup('postgres'));
    feed(message('Q', 'select 1'));
    feed(Buffer.concat([message('P', 'select $1'), message('B'), message('E')]));
    expect(queries()).toBe(2);
  });

  it('reassembles a query split across chunks, and one split from its own header', () => {
    const { queries, feed } = tapping();
    feed(startup('postgres'));
    const query = message('Q', 'select 1');
    feed(query.subarray(0, 3));
    feed(query.subarray(3, 7));
    feed(query.subarray(7));
    expect(queries()).toBe(1);
  });

  it('waits for a startup packet that arrives in pieces, after an SSL request', () => {
    const { queries, feed } = tapping();
    const ssl = Buffer.alloc(8);
    ssl.writeInt32BE(8, 0);
    ssl.writeInt32BE(80877103, 4);
    const packet = startup('postgres');
    feed(Buffer.concat([ssl, packet.subarray(0, 6)]));
    feed(packet.subarray(6));
    feed(message('Q', 'select 1'));
    expect(queries()).toBe(1);
  });

  it('reports nothing before the startup packet', () => {
    const { queries, feed } = tapping();
    feed(message('Q', 'select 1'));
    expect(queries()).toBe(0);
  });

  it('never lets a query text be read as a message header', () => {
    const { queries, feed } = tapping();
    feed(startup('postgres'));
    // 'Q' and 'B' inside the text are payload, not the start of another message
    feed(message('Q', "select 'QBQB' as noise"));
    expect(queries()).toBe(1);
  });
});
