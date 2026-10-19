import { afterEach, describe, expect, it, vi } from 'vitest';
import clockModule from '../../../src/main/clock.js';

const { createClock } = clockModule;

afterEach(() => {
  vi.useRealTimers();
});

describe('createClock', () => {
  it('reads the system clock when the offset is zero', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    const clock = createClock();
    expect(clock.now()).toBe(Date.parse('2026-01-02T03:04:05.000Z'));
    expect(clock.offsetMs).toBe(0);
  });

  it('applies an initial offset', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    const clock = createClock({ offsetMs: 60_000 });
    expect(clock.now()).toBe(Date.parse('2026-01-02T03:05:05.000Z'));
    expect(clock.offsetMs).toBe(60_000);
  });

  it('replaces and advances the offset', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    const clock = createClock();
    clock.setOffset(5_000);
    expect(clock.now()).toBe(Date.parse('2026-01-02T03:04:10.000Z'));
    clock.advance(10_000);
    expect(clock.offsetMs).toBe(15_000);
    clock.advance(-20_000);
    expect(clock.offsetMs).toBe(-5_000);
  });

  it('sets an absolute instant through setNow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    const clock = createClock();
    clock.setNow(Date.parse('2030-06-01T00:00:00.000Z'));
    expect(clock.now()).toBe(Date.parse('2030-06-01T00:00:00.000Z'));
  });

  it('ignores non-finite input', () => {
    const clock = createClock({ offsetMs: Number.NaN });
    expect(clock.offsetMs).toBe(0);
    clock.setOffset(Number.POSITIVE_INFINITY);
    expect(clock.offsetMs).toBe(0);
    clock.advance(Number.NaN);
    expect(clock.offsetMs).toBe(0);
    clock.setNow(Number.NaN);
    expect(clock.offsetMs).toBe(0);
  });
});
