import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import serviceModule from '../../../src/main/timer-service.js';
import { createFakeClock } from '../../helpers/clock.js';

const { createTimerService } = serviceModule;
const MIN = 60_000;
const SETTINGS = {
  durations: { focus: 25, short: 5, long: 15 },
  rounds: 4,
  autoBreak: false,
  autoFocus: false,
};

function createFakeStore(initial = {}) {
  let document = { ...SETTINGS, ...initial };
  const writes = [];
  return {
    get: () => document,
    set(patch, value) {
      if (typeof patch === 'string') patch = { [patch]: value };
      document = { ...document, ...patch };
      writes.push(JSON.parse(JSON.stringify(patch)));
      return { value: document, issues: [] };
    },
    flush: vi.fn(),
    writes,
    read: () => document,
  };
}

async function setup({ start = 0, initial = {} } = {}) {
  const clock = createFakeClock(start);
  const store = createFakeStore(initial);
  const broadcast = vi.fn();
  const onPhaseComplete = vi.fn();
  const service = await createTimerService({
    store,
    clock,
    broadcast,
    logger: null,
    onPhaseComplete,
  });
  return { clock, store, broadcast, onPhaseComplete, service };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('timer service', () => {
  it('starts from the core defaults and does not publish on construction', async () => {
    const { service, broadcast, store } = await setup();
    expect(service.get()).toMatchObject({
      phase: 'focus',
      status: 'idle',
      remainingMs: 25 * MIN,
      rounds: 0,
    });
    expect(broadcast).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
  });

  it('publishes and persists on start', async () => {
    const { service, broadcast, store } = await setup();
    const snapshot = service.start();
    expect(snapshot.status).toBe('running');
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(
      'timer:snapshot',
      expect.objectContaining({ status: 'running' })
    );
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toEqual({ timer: expect.objectContaining({ status: 'running' }) });
  });

  it('treats a second start as a no-op', async () => {
    const { service, broadcast, store } = await setup();
    service.start();
    service.start();
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(store.writes).toHaveLength(1);
  });

  it('broadcasts every tick and persists at most every five seconds', async () => {
    const { clock, service, broadcast, store } = await setup();
    service.start();
    broadcast.mockClear();
    store.writes.length = 0;

    for (let index = 0; index < 10; index += 1) {
      clock.advance(500);
      vi.advanceTimersByTime(500);
    }

    expect(broadcast).toHaveBeenCalledTimes(10);
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0].timer).toMatchObject({ status: 'running' });
  });

  it('stops ticking while paused', async () => {
    const { clock, service, broadcast } = await setup();
    service.start();
    service.pause();
    broadcast.mockClear();

    clock.advance(5_000);
    vi.advanceTimersByTime(5_000);
    expect(broadcast).not.toHaveBeenCalled();
    expect(service.get().status).toBe('paused');
  });

  it('publishes and persists a settings change', async () => {
    const { service, broadcast, store } = await setup();
    service.start();
    broadcast.mockClear();
    store.writes.length = 0;

    service.applySettings({ ...SETTINGS, durations: { focus: 50, short: 5, long: 15 } });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(store.writes).toHaveLength(1);
  });

  it('keeps the current duration and applies the new one at the next focus', async () => {
    const { clock, service } = await setup();
    service.start();
    const before = service.get();
    service.applySettings({ ...SETTINGS, durations: { focus: 50, short: 5, long: 15 } });
    const applied = service.get();
    expect(applied.durationMs).toBe(25 * MIN);
    expect(applied.settingsRevision).toBe(1);

    clock.advance(before.remainingMs);
    vi.advanceTimersByTime(500);
    expect(service.get()).toMatchObject({ phase: 'short', status: 'done' });

    service.start();
    const short = service.get();
    clock.advance(short.remainingMs);
    vi.advanceTimersByTime(500);
    expect(service.get()).toMatchObject({
      phase: 'focus',
      status: 'done',
      durationMs: 50 * MIN,
    });
  });

  it('restores a running snapshot before any window exists', async () => {
    const saved = {
      phase: 'focus',
      status: 'running',
      remainingMs: 25 * MIN,
      durationMs: 25 * MIN,
      endsAtWall: 25 * MIN,
      rounds: 0,
      settingsRevision: 0,
    };
    const { service, broadcast, store } = await setup({ initial: { timer: saved } });
    expect(service.get()).toMatchObject({
      phase: 'focus',
      status: 'running',
      remainingMs: 25 * MIN,
    });
    expect(broadcast).not.toHaveBeenCalled();
    expect(store.writes).toHaveLength(1);
    service.dispose();
  });

  it('queues one missed-phase notice for the first subscriber', async () => {
    const saved = {
      phase: 'focus',
      status: 'running',
      remainingMs: 25 * MIN,
      durationMs: 25 * MIN,
      endsAtWall: 25 * MIN,
      rounds: 0,
      settingsRevision: 0,
    };
    const { service, onPhaseComplete } = await setup({
      start: 55 * MIN,
      initial: { timer: saved },
    });

    expect(service.get()).toMatchObject({
      phase: 'short',
      status: 'paused',
      rounds: 1,
      remainingMs: 5 * MIN,
    });
    expect(onPhaseComplete).toHaveBeenCalledTimes(1);

    const first = service.subscribe();
    expect(first.snapshot.phase).toBe('short');
    expect(first.notice).toMatchObject({ type: 'missed-while-away' });
    expect(service.subscribe().notice).toBeNull();
    service.dispose();
  });

  it('forwards phase-complete to the notification hook', async () => {
    const { clock, service, onPhaseComplete } = await setup();
    service.start();
    clock.advance(25 * MIN);
    vi.advanceTimersByTime(500);

    expect(onPhaseComplete).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'phase-complete', completedPhase: 'focus' })
    );
    expect(service.get()).toMatchObject({ phase: 'short', status: 'done' });
  });

  it('dispose stops the ticker and writes the final snapshot', async () => {
    const { clock, service, broadcast, store } = await setup();
    service.start();
    broadcast.mockClear();
    store.writes.length = 0;

    service.dispose();
    expect(store.writes).toHaveLength(1);
    clock.advance(5_000);
    vi.advanceTimersByTime(5_000);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('subscribe returns the current snapshot without a notice', async () => {
    const { service } = await setup();
    expect(service.subscribe()).toMatchObject({
      snapshot: { phase: 'focus', status: 'idle' },
      notice: null,
    });
  });
});
