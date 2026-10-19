import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../../src/renderer/shared/scheduler.js';

describe('createScheduler', () => {
  let frames;
  let realRaf;
  let realCaf;

  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    realRaf = globalThis.requestAnimationFrame;
    realCaf = globalThis.cancelAnimationFrame;
    let nextId = 0;
    globalThis.requestAnimationFrame = (callback) => {
      nextId += 1;
      frames.push({ id: nextId, callback, cancelled: false });
      return nextId;
    };
    globalThis.cancelAnimationFrame = (handle) => {
      const entry = frames.find((frame) => frame.id === handle);
      if (entry) entry.cancelled = true;
    };
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCaf;
    vi.useRealTimers();
  });

  function runFrame() {
    const entry = frames.shift();
    if (!entry || entry.cancelled) return false;
    entry.callback(0);
    return true;
  }

  it('does nothing until a loop is asked to start', () => {
    const onTick = vi.fn();
    const onFrame = vi.fn();
    const scheduler = createScheduler({ onTick, onFrame });

    vi.advanceTimersByTime(10_000);
    runFrame();

    expect(onTick).not.toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
    expect(scheduler.isTicking()).toBe(false);
    expect(scheduler.isAnimating()).toBe(false);
  });

  it('ticks once per second while started and stops on demand', () => {
    const onTick = vi.fn();
    const scheduler = createScheduler({ onTick });

    scheduler.startTicks();
    expect(scheduler.isTicking()).toBe(true);

    vi.advanceTimersByTime(999);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_000);
    expect(onTick).toHaveBeenCalledTimes(4);

    scheduler.stopTicks();
    expect(scheduler.isTicking()).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(onTick).toHaveBeenCalledTimes(4);
  });

  it('is idempotent when start is called twice', () => {
    const onTick = vi.fn();
    const scheduler = createScheduler({ onTick });
    scheduler.startTicks();
    scheduler.startTicks();
    vi.advanceTimersByTime(1_000);
    expect(onTick).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('restarts the tick loop at a new cadence', () => {
    const onTick = vi.fn();
    const scheduler = createScheduler({ onTick });
    scheduler.startTicks();

    scheduler.setTickHz(2);
    vi.advanceTimersByTime(499);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(onTick).toHaveBeenCalledTimes(2);

    scheduler.setTickHz(2);
    vi.advanceTimersByTime(500);
    expect(onTick).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('treats a non-positive cadence as one hertz', () => {
    const onTick = vi.fn();
    const scheduler = createScheduler({ onTick, tickHz: 0 });
    scheduler.startTicks();
    vi.advanceTimersByTime(999);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTick).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('requests exactly one animation frame per loop', () => {
    const onFrame = vi.fn();
    const scheduler = createScheduler({ onFrame });

    scheduler.requestFrames();
    scheduler.requestFrames();
    expect(frames).toHaveLength(1);
    expect(scheduler.isAnimating()).toBe(true);

    expect(runFrame()).toBe(true);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(1);

    expect(runFrame()).toBe(true);
    expect(onFrame).toHaveBeenCalledTimes(2);
    scheduler.stopFrames();
    expect(scheduler.isAnimating()).toBe(false);
    expect(runFrame()).toBe(false);
    expect(onFrame).toHaveBeenCalledTimes(2);
  });

  it('stops both loops together', () => {
    const onTick = vi.fn();
    const onFrame = vi.fn();
    const scheduler = createScheduler({ onTick, onFrame });
    scheduler.startTicks();
    scheduler.requestFrames();

    scheduler.stop();
    vi.advanceTimersByTime(5_000);

    expect(onTick).not.toHaveBeenCalled();
    expect(runFrame()).toBe(false);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('falls back to a timeout when requestAnimationFrame is missing', () => {
    globalThis.requestAnimationFrame = undefined;
    globalThis.cancelAnimationFrame = undefined;
    const onFrame = vi.fn();
    const scheduler = createScheduler({ onFrame, now: () => 42 });

    scheduler.requestFrames();
    vi.advanceTimersByTime(15);
    expect(onFrame).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(16);
    expect(onFrame).toHaveBeenCalledTimes(2);
    scheduler.stopFrames();
    vi.advanceTimersByTime(64);
    expect(onFrame).toHaveBeenCalledTimes(2);
  });
});
