import { describe, expect, it } from 'vitest';
import { callerIn, callerPath } from './caller.js';

describe('callerIn', () => {
  it('reads back the node an address was built for, whatever its id holds', () => {
    for (const id of ['abc123', 'node with spaces', 'a/b']) {
      expect(callerIn(`${callerPath(id)}/charges`)).toEqual({ node: id, path: '/charges' });
    }
  });

  it('keeps the query, and calls the bare address the root', () => {
    expect(callerIn(`${callerPath('n')}/charges?payment=3`).path).toBe('/charges?payment=3');
    expect(callerIn(callerPath('n')).path).toBe('/');
    expect(callerIn(`${callerPath('n')}?payment=3`).path).toBe('/?payment=3');
  });

  it('names no one for an address it did not hand out', () => {
    expect(callerIn('/charges')).toEqual({ node: undefined, path: '/charges' });
  });
});
