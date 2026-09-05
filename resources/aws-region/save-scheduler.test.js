import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveScheduler } from './save-scheduler.js';

// What server.js passes, so the numbers in the assertions are the real windows
const DEBOUNCE_MS = 500;
const MAX_WAIT_MS = 1000;

function setup() {
  const saves = [];
  const scheduler = new SaveScheduler({
    save: () => saves.push(Date.now()),
    debounceMs: DEBOUNCE_MS,
    maxWaitMs: MAX_WAIT_MS,
  });
  return { scheduler, saves, advance: (ms) => vi.advanceTimersByTime(ms) };
}

describe('SaveScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('saves immediately on the first request after a quiet spell', () => {
    const { scheduler, saves } = setup();
    scheduler.arm();
    expect(saves).toEqual([0]);
  });

  it('does not save again when nothing followed the leading edge', () => {
    const { scheduler, saves, advance } = setup();
    scheduler.arm();
    advance(5000);
    expect(saves).toEqual([0]);
  });

  it('coalesces the burst behind the leading edge into one trailing save', () => {
    const { scheduler, saves, advance } = setup();
    scheduler.arm();
    advance(100);
    scheduler.arm();
    advance(100);
    scheduler.arm();
    advance(5000);
    expect(saves).toEqual([0, 700]);
  });

  it('caps sustained traffic at the max wait rather than saving per request', () => {
    const { scheduler, saves, advance } = setup();
    for (let elapsed = 0; elapsed <= 3000; elapsed += 200) {
      scheduler.arm();
      advance(200);
    }
    expect(saves).toEqual([0, 1000, 2000, 3000]);
  });

  it('takes the leading edge again once a debounce has passed with no traffic', () => {
    const { scheduler, saves, advance } = setup();
    scheduler.arm();
    advance(600);
    scheduler.arm();
    expect(saves).toEqual([0, 600]);
  });

  it('saves nothing more after stop', () => {
    const { scheduler, saves, advance } = setup();
    scheduler.arm();
    advance(100);
    scheduler.arm();
    scheduler.stop();
    advance(5000);
    scheduler.arm();
    expect(saves).toEqual([0]);
  });
});
