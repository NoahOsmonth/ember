import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import powerModule from '../../../src/main/power.js';
import serviceModule from '../../../src/main/timer-service.js';
import { createFakeClock } from '../../helpers/clock.js';

const { createPowerWatcher, JUMP_THRESHOLD_MS } = powerModule;
const { createTimerService } = serviceModule;

const MIN = 60_000;
const START = Date.parse('2026-01-02T03:04:05.000Z');
const SETTINGS = {
  durations: { focus: 25, short: 5, long: 15 },
  rounds: 4,
  autoBreak: false,
  autoFocus: false,
};

/** An EventEmitter stand-in for `powerMonitor` / `screen`. */
function fakeEmitter() {
  const listeners = new Map();
  return {
    on(event, handler) {
      const list = listeners.get(event) || [];
      list.push(handler);
      listeners.set(event, list);
    },
    removeListener(event, handler) {
      const list = listeners.get(event) || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    emit(event, ...args) {
      for (const handler of [...(listeners.get(event) || [])]) handler(...args);
    },
    count() {
      let total = 0;
      for (const list of listeners.values()) total += list.length;
      return total;
    },
  };
}

function createFakeStore() {
  let document = /** @type {any} */ ({ ...SETTINGS });
  return {
    get: () => document,
    set(patch, value) {
      if (typeof patch === 'string') patch = { [patch]: value };
      document = { ...document, ...patch };
      return { value: document, issues: [] };
    },
    flush: vi.fn(),
    read: () => document,
  };
}

async function setup() {
  const clock = createFakeClock(START);
  const store = createFakeStore();
  const onPhaseComplete = vi.fn();
  const service = await createTimerService({
    store,
    clock,
    broadcast: () => {},
    logger: null,
    onPhaseComplete,
  });
  const windows = { reassert: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const powerMonitor = fakeEmitter();
  const screen = fakeEmitter();
  let mono = 0;
  const watcher = createPowerWatcher({
    clock,
    timer: service,
    windows,
    logger,
    powerMonitor,
    screen,
    monotonic: () => mono,
    sampleMs: 1_000,
  });
  return {
    clock,
    store,
    service,
    onPhaseComplete,
    windows,
    logger,
    powerMonitor,
    screen,
    watcher,
    advanceMono(ms) {
      mono += ms;
    },
  };
}

const cleanups = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
  vi.useRealTimers();
});

async function fresh() {
  const context = await setup();
  cleanups.push(() => {
    context.watcher.dispose();
    context.service.dispose();
  });
  return context;
}

describe('power watcher', () => {
  it('documents a threshold of at least one minute', () => {
    expect(JUMP_THRESHOLD_MS).toBe(60_000);
  });

  it('keeps the phase running across a short sleep and reasserts the window', async () => {
    const { clock, service, watcher, onPhaseComplete, windows } = await fresh();
    service.start();
    clock.advance(3 * MIN);

    const after = watcher.handleResume(3 * MIN);

    expect(after).toMatchObject({ phase: 'focus', status: 'running' });
    expect(after.remainingMs).toBe(22 * MIN);
    expect(onPhaseComplete).not.toHaveBeenCalled();
    expect(windows.reassert).toHaveBeenCalled();
  });

  it('lands on the break after a boundary-crossing sleep with one quiet notice', async () => {
    const { clock, service, watcher, onPhaseComplete } = await fresh();
    service.start();
    clock.advance(40 * MIN);

    const after = watcher.handleResume(40 * MIN);

    expect(after).toMatchObject({ phase: 'short', status: 'paused', remainingMs: 5 * MIN });
    expect(onPhaseComplete).toHaveBeenCalledTimes(1);
    expect(onPhaseComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'phase-complete',
        completedPhase: 'focus',
        quiet: true,
        awayMs: 40 * MIN,
      })
    );
  });

  it('does not advance again when a duplicate resume arrives', async () => {
    const { clock, service, watcher, onPhaseComplete } = await fresh();
    service.start();
    clock.advance(40 * MIN);
    watcher.handleResume(40 * MIN);
    onPhaseComplete.mockClear();

    const after = watcher.handleResume(0);

    expect(after).toMatchObject({ phase: 'short', status: 'paused' });
    expect(onPhaseComplete).not.toHaveBeenCalled();
  });

  it('uses the monotonic reading taken at suspend for the away duration', async () => {
    const { clock, service, powerMonitor, advanceMono, onPhaseComplete } = await fresh();
    service.start();

    powerMonitor.emit('suspend');
    clock.advance(10 * MIN);
    advanceMono(10 * MIN);
    powerMonitor.emit('resume');

    expect(service.get()).toMatchObject({ phase: 'focus', status: 'running' });
    expect(service.get().remainingMs).toBe(15 * MIN);
    expect(onPhaseComplete).not.toHaveBeenCalled();
  });

  it('re-anchors after a backwards clock jump so remaining time is preserved', async () => {
    const { clock, service, watcher, logger, advanceMono } = await fresh();
    service.start();
    clock.advance(5 * MIN);
    advanceMono(5 * MIN);
    expect(watcher.sample()).toBeNull();

    clock.advance(-10 * MIN);
    const drift = watcher.sample();

    const snapshot = service.get();
    expect(drift).toBe(-10 * MIN);
    expect(snapshot).toMatchObject({ phase: 'focus', status: 'running' });
    expect(snapshot.remainingMs).toBe(20 * MIN);
    expect(snapshot.endsAtWall).toBe(clock.now() + 20 * MIN);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('backwards'));
  });

  it('treats a forwards clock jump as elapsed time with one quiet notice', async () => {
    const { clock, service, watcher, logger, onPhaseComplete } = await fresh();
    service.start();

    clock.advance(30 * MIN);
    const drift = watcher.sample();

    expect(drift).toBe(30 * MIN);
    expect(service.get()).toMatchObject({ phase: 'short', status: 'paused' });
    expect(onPhaseComplete).toHaveBeenCalledTimes(1);
    expect(onPhaseComplete).toHaveBeenCalledWith(
      expect.objectContaining({ quiet: true, awayMs: 30 * MIN })
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('forwards'));
  });

  it('ignores a correction smaller than the threshold', async () => {
    const { clock, service, watcher, logger, onPhaseComplete } = await fresh();
    service.start();

    clock.advance(-2_000);
    expect(watcher.sample()).toBeNull();

    expect(service.get()).toMatchObject({
      phase: 'focus',
      status: 'running',
      remainingMs: 25 * MIN,
    });
    expect(onPhaseComplete).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('flushes the persisted snapshot on shutdown', async () => {
    const { service, watcher, store } = await fresh();
    service.start();

    watcher.handleShutdown();

    expect(store.flush).toHaveBeenCalled();
    expect(store.read().timer).toMatchObject({ phase: 'focus', status: 'running' });
  });

  it('reasserts the window on unlock and on a display change', async () => {
    const { watcher, windows, powerMonitor, screen, logger } = await fresh();

    powerMonitor.emit('lock-screen');
    powerMonitor.emit('unlock-screen');
    screen.emit('display-metrics-changed');
    watcher.handleDisplayChange();

    expect(windows.reassert).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith('screen locked');
  });

  it('treats a resume without a recorded suspend as zero away time', async () => {
    const { service, watcher, onPhaseComplete } = await fresh();
    service.start();

    watcher.handleResume();

    expect(service.get()).toMatchObject({
      phase: 'focus',
      status: 'running',
      remainingMs: 25 * MIN,
    });
    expect(onPhaseComplete).not.toHaveBeenCalled();
  });

  it('samples with a default monotonic source when none is injected', async () => {
    const clock = createFakeClock(START);
    const watcher = createPowerWatcher({ clock, timer: null });
    cleanups.push(() => watcher.dispose());

    expect(() => watcher.sample()).not.toThrow();
  });

  it('disposes every subscription and the sampler', async () => {
    const { watcher, windows, powerMonitor, screen } = await fresh();
    expect(powerMonitor.count()).toBe(5);
    expect(screen.count()).toBe(1);

    watcher.dispose();
    expect(powerMonitor.count()).toBe(0);
    expect(screen.count()).toBe(0);

    powerMonitor.emit('unlock-screen');
    screen.emit('display-metrics-changed');
    expect(windows.reassert).not.toHaveBeenCalled();
  });

  it('is idempotent when disposed twice', async () => {
    const { watcher } = await fresh();
    watcher.dispose();
    expect(() => watcher.dispose()).not.toThrow();
  });
});
