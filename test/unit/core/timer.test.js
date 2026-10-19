import { describe, expect, it, vi } from 'vitest';
import { createTimer } from '../../../src/core/timer.js';
import { createFakeClock } from '../../helpers/clock.js';

const MIN = 60_000;
const SETTINGS = {
  durations: { focus: 25, short: 5, long: 15 },
  rounds: 4,
  autoBreak: false,
  autoFocus: false,
};

function setup(overrides = {}, start = 1_000_000) {
  const clock = createFakeClock(start);
  /** @type {any[]} */
  const events = [];
  const settings = {
    ...SETTINGS,
    ...overrides,
    durations: { ...SETTINGS.durations, ...(overrides.durations || {}) },
  };
  const timer = createTimer({
    clock,
    settings,
    onEvent: (event) => events.push(event),
  });
  return { clock, timer, events, settings };
}

const completeCurrentPhase = (clock, timer) => {
  const end = timer.snapshot().endsAtWall;
  clock.set(end);
  return timer.tick(clock.now());
};

describe('initial state', () => {
  it('starts idle in focus with the full duration', () => {
    const { timer } = setup();
    expect(timer.snapshot()).toEqual({
      phase: 'focus',
      status: 'idle',
      remainingMs: 25 * MIN,
      durationMs: 25 * MIN,
      endsAtWall: null,
      rounds: 0,
      settingsRevision: 0,
    });
  });

  it('uses defaults when settings are omitted', () => {
    const timer = createTimer({ clock: createFakeClock() });
    expect(timer.snapshot()).toMatchObject({
      phase: 'focus',
      status: 'idle',
      remainingMs: 25 * MIN,
      durationMs: 25 * MIN,
      rounds: 0,
    });
  });

  it('normalizes malformed settings without throwing', () => {
    const timer = createTimer({
      clock: createFakeClock(),
      settings: { durations: { focus: -1, short: 'x', long: 0 }, rounds: 0, autoBreak: 'yes' },
    });
    expect(timer.snapshot().durationMs).toBe(25 * MIN);
    expect(timer.snapshot().rounds).toBe(0);
  });
});

describe('the transition table', () => {
  it('idle start -> running, with endsAtWall derived from the clock', () => {
    const { timer, events } = setup({}, 5_000);
    const snapshot = timer.start();
    expect(snapshot.status).toBe('running');
    expect(snapshot.endsAtWall).toBe(5_000 + 25 * MIN);
    expect(events.map((event) => event.type)).toEqual(['phase-started']);
  });

  it('running pause -> paused, capturing the remaining time', () => {
    const { clock, timer } = setup();
    timer.start();
    clock.advance(MIN);
    const snapshot = timer.pause();
    expect(snapshot.status).toBe('paused');
    expect(snapshot.remainingMs).toBe(24 * MIN);
    expect(snapshot.endsAtWall).toBeNull();
  });

  it('paused start -> running, recomputing endsAtWall', () => {
    const { clock, timer } = setup();
    timer.start();
    clock.advance(MIN);
    timer.pause();
    clock.advance(30_000);
    const snapshot = timer.start();
    expect(snapshot.status).toBe('running');
    expect(snapshot.remainingMs).toBe(24 * MIN);
    expect(snapshot.endsAtWall).toBe(clock.now() + 24 * MIN);
  });

  it('pausing an idle timer does nothing', () => {
    const { timer } = setup();
    const before = timer.snapshot();
    expect(timer.pause()).toEqual(before);
    expect(timer.snapshot()).toEqual(before);
  });

  it('starting a running timer does nothing', () => {
    const { timer } = setup();
    timer.start();
    const before = timer.snapshot();
    expect(timer.start()).toEqual(before);
  });

  it('tick past the end selects the next phase and is done when auto-start is off', () => {
    const { clock, timer, events } = setup();
    timer.start();
    const snapshot = completeCurrentPhase(clock, timer);
    expect(snapshot).toMatchObject({
      phase: 'short',
      status: 'done',
      remainingMs: 5 * MIN,
      durationMs: 5 * MIN,
      rounds: 1,
      endsAtWall: null,
    });
    expect(events.map((event) => event.type)).toEqual(['phase-started', 'phase-complete']);
  });

  it('tick past the end auto-starts when the next phase allows it', () => {
    const { clock, timer, events } = setup({ autoBreak: true });
    timer.start();
    const snapshot = completeCurrentPhase(clock, timer);
    expect(snapshot.phase).toBe('short');
    expect(snapshot.status).toBe('running');
    expect(snapshot.endsAtWall).toBe(clock.now() + 5 * MIN);
    expect(events.map((event) => event.type)).toEqual([
      'phase-started',
      'phase-complete',
      'phase-started',
    ]);
  });

  it('done start -> running, starting the already selected phase', () => {
    const { clock, timer } = setup();
    timer.start();
    completeCurrentPhase(clock, timer);
    clock.advance(10_000);
    const snapshot = timer.start();
    expect(snapshot.phase).toBe('short');
    expect(snapshot.status).toBe('running');
    expect(snapshot.endsAtWall).toBe(clock.now() + 5 * MIN);
  });

  it('any reset -> idle focus with rounds zero', () => {
    const { clock, timer } = setup({ autoBreak: true });
    timer.start();
    completeCurrentPhase(clock, timer);
    const snapshot = timer.reset();
    expect(snapshot).toMatchObject({
      phase: 'focus',
      status: 'idle',
      rounds: 0,
      remainingMs: 25 * MIN,
      endsAtWall: null,
    });
  });

  it('toggle pauses a running timer and starts a paused one', () => {
    const { timer } = setup();
    expect(timer.toggle().status).toBe('running');
    expect(timer.toggle().status).toBe('paused');
    expect(timer.toggle().status).toBe('running');
  });
});

describe('remaining time is derived, not decremented', () => {
  it('a late tick reflects the full elapsed time', () => {
    const { clock, timer } = setup({}, 0);
    timer.start();
    clock.set(10_000);
    timer.tick(clock.now());
    expect(timer.snapshot().remainingMs).toBe(25 * MIN - 10_000);
    clock.set(40_000);
    timer.tick(clock.now());
    expect(timer.snapshot().remainingMs).toBe(25 * MIN - 40_000);
  });

  it('clamps at zero when paused after the end', () => {
    const { clock, timer } = setup();
    timer.start();
    clock.set(timer.snapshot().endsAtWall + 5_000);
    const snapshot = timer.pause();
    expect(snapshot.status).toBe('paused');
    expect(snapshot.remainingMs).toBe(0);
  });

  it('clamps a restored negative remaining time to zero', () => {
    const { clock, timer } = setup();
    timer.restore(
      {
        phase: 'focus',
        status: 'paused',
        remainingMs: -5_000,
        durationMs: 25 * MIN,
        endsAtWall: null,
        rounds: 0,
        settingsRevision: 0,
      },
      clock.now()
    );
    expect(timer.snapshot().remainingMs).toBe(0);
  });

  it('works when Date.now throws', () => {
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('the timer must not read Date.now');
    });
    let snapshot;
    try {
      const clock = createFakeClock(0);
      const timer = createTimer({ clock });
      timer.start();
      snapshot = timer.tick(1_000);
      timer.pause();
      timer.restore(timer.snapshot(), 2_000);
    } finally {
      spy.mockRestore();
    }
    expect(snapshot.status).toBe('running');
  });
});

describe('events fire once per occurrence', () => {
  it('ten ticks after the end emit phase-complete once', () => {
    const { clock, timer, events } = setup();
    timer.start();
    completeCurrentPhase(clock, timer);
    for (let index = 0; index < 10; index += 1) timer.tick(clock.now() + index);
    expect(events.filter((event) => event.type === 'phase-complete')).toHaveLength(1);
  });

  it('a paused tick is silent', () => {
    const { timer, events } = setup();
    timer.start();
    timer.pause();
    const count = events.length;
    timer.tick(1_000_000_000);
    expect(events).toHaveLength(count);
  });

  it('phase-complete sees the new phase, not the old one', () => {
    const clock = createFakeClock(0);
    const seen = [];
    let timer;
    timer = createTimer({
      clock,
      settings: SETTINGS,
      onEvent: (event) => {
        if (event.type === 'phase-complete') seen.push(timer.snapshot());
      },
    });
    timer.start();
    completeCurrentPhase(clock, timer);
    expect(seen[0].phase).toBe('short');
    expect(seen[0].status).toBe('done');
  });

  it('a throwing listener does not stop other listeners', () => {
    const clock = createFakeClock(0);
    const seen = [];
    const timer = createTimer({
      clock,
      settings: SETTINGS,
      onEvent: () => {
        throw new Error('bad listener');
      },
    });
    timer.subscribe((event) => seen.push(event.type));
    expect(() => timer.start()).not.toThrow();
    expect(seen).toEqual(['phase-started']);
  });

  it('subscribe returns an unsubscribe function', () => {
    const clock = createFakeClock(0);
    const timer = createTimer({ clock, settings: SETTINGS });
    const seen = [];
    const unsubscribe = timer.subscribe((event) => seen.push(event.type));
    timer.start();
    unsubscribe();
    timer.pause();
    expect(seen).toEqual(['phase-started']);
  });
});

describe('round accounting', () => {
  it('runs a full four-round cycle', () => {
    const { clock, timer } = setup();
    for (let round = 1; round <= 4; round += 1) {
      timer.start();
      let snapshot = completeCurrentPhase(clock, timer);
      expect(snapshot.phase).toBe(round === 4 ? 'long' : 'short');
      expect(snapshot.rounds).toBe(round);
      expect(snapshot.status).toBe('done');

      timer.start();
      snapshot = completeCurrentPhase(clock, timer);
      expect(snapshot.phase).toBe('focus');
      expect(snapshot.rounds).toBe(round === 4 ? 0 : round);
    }
  });

  it('supports a one-round cycle', () => {
    const { clock, timer } = setup({ rounds: 1 });
    timer.start();
    let snapshot = completeCurrentPhase(clock, timer);
    expect(snapshot).toMatchObject({ phase: 'long', rounds: 1, status: 'done' });

    timer.start();
    snapshot = completeCurrentPhase(clock, timer);
    expect(snapshot).toMatchObject({ phase: 'focus', rounds: 0, status: 'done' });
  });

  it('skipping a long break resets the round counter', () => {
    const { clock, timer } = setup({ rounds: 1 });
    timer.start();
    completeCurrentPhase(clock, timer);
    timer.start();
    const snapshot = timer.skip();
    expect(snapshot.phase).toBe('focus');
    expect(snapshot.rounds).toBe(0);
    expect(snapshot.status).toBe('idle');
  });

  it('skipping a focus credits nothing and moves to a break', () => {
    const { timer, events } = setup();
    timer.start();
    const snapshot = timer.skip();
    expect(snapshot.phase).toBe('short');
    expect(snapshot.rounds).toBe(0);
    expect(events.filter((event) => event.type === 'phase-complete')).toHaveLength(0);
  });

  it('skipping a short break moves to focus without changing rounds', () => {
    const { clock, timer } = setup();
    timer.start();
    completeCurrentPhase(clock, timer);
    timer.start();
    const snapshot = timer.skip();
    expect(snapshot.phase).toBe('focus');
    expect(snapshot.rounds).toBe(1);
  });

  it('skips from idle and done are no-ops', () => {
    const { clock, timer } = setup();
    expect(timer.skip().status).toBe('idle');
    timer.start();
    completeCurrentPhase(clock, timer);
    const before = timer.snapshot();
    expect(timer.skip()).toEqual(before);
  });

  it('skip auto-starts the next phase when its auto flag is on', () => {
    const { timer, events } = setup({ autoBreak: false, autoFocus: true });
    timer.start();
    let snapshot = timer.skip();
    expect(snapshot).toMatchObject({ phase: 'short', status: 'idle' });

    timer.start();
    snapshot = timer.skip();
    expect(snapshot).toMatchObject({ phase: 'focus', status: 'running' });
    expect(events.filter((event) => event.type === 'phase-complete')).toHaveLength(0);
  });

  it('paused skip advances without completing', () => {
    const { timer, events } = setup();
    timer.start();
    timer.pause();
    const snapshot = timer.skip();
    expect(snapshot.phase).toBe('short');
    expect(events.filter((event) => event.type === 'phase-complete')).toHaveLength(0);
  });
});

describe('settings changes', () => {
  it('a duration change during a running focus waits for the next focus', () => {
    const { clock, timer } = setup();
    timer.start();
    const endsAtWall = timer.snapshot().endsAtWall;
    const applied = timer.applySettings({
      ...SETTINGS,
      durations: { focus: 50, short: 5, long: 15 },
    });
    expect(applied.durationMs).toBe(25 * MIN);
    expect(applied.endsAtWall).toBe(endsAtWall);
    expect(applied.settingsRevision).toBe(1);

    completeCurrentPhase(clock, timer);
    timer.start();
    completeCurrentPhase(clock, timer);
    expect(timer.snapshot().phase).toBe('focus');
    expect(timer.snapshot().durationMs).toBe(50 * MIN);
  });

  it('a duration change while idle applies immediately', () => {
    const { timer } = setup();
    const snapshot = timer.applySettings({
      ...SETTINGS,
      durations: { focus: 50, short: 5, long: 15 },
    });
    expect(snapshot.durationMs).toBe(50 * MIN);
    expect(snapshot.remainingMs).toBe(50 * MIN);
  });

  it('a duration change while paused does not alter the current phase', () => {
    const { clock, timer } = setup();
    timer.start();
    clock.advance(MIN);
    timer.pause();
    const snapshot = timer.applySettings({
      ...SETTINGS,
      durations: { focus: 50, short: 5, long: 15 },
    });
    expect(snapshot.durationMs).toBe(25 * MIN);
    expect(snapshot.remainingMs).toBe(24 * MIN);
  });

  it('a duration change while done applies to the selected phase', () => {
    const { clock, timer } = setup();
    timer.start();
    completeCurrentPhase(clock, timer);
    const snapshot = timer.applySettings({
      ...SETTINGS,
      durations: { focus: 25, short: 10, long: 15 },
    });
    expect(snapshot.phase).toBe('short');
    expect(snapshot.durationMs).toBe(10 * MIN);
    expect(snapshot.remainingMs).toBe(10 * MIN);
  });

  it('bumps the revision on every call', () => {
    const { timer } = setup();
    timer.applySettings(SETTINGS);
    expect(timer.applySettings(SETTINGS).settingsRevision).toBe(2);
  });
});

describe('snapshots and restore', () => {
  const roundTrip = (mutate) => {
    const { clock, timer, settings } = setup();
    mutate(clock, timer);
    const saved = JSON.parse(JSON.stringify(timer.snapshot()));
    const restored = createTimer({ clock, settings });
    restored.restore(saved, clock.now());
    return { saved, restored: restored.snapshot() };
  };

  it('round-trips a running timer', () => {
    const { saved, restored } = roundTrip((clock, timer) => {
      timer.start();
      clock.advance(MIN);
      timer.tick(clock.now());
    });
    expect(restored).toEqual(saved);
  });

  it('round-trips a paused timer', () => {
    const { saved, restored } = roundTrip((clock, timer) => {
      timer.start();
      clock.advance(MIN);
      timer.pause();
    });
    expect(restored).toEqual(saved);
  });

  it('round-trips an idle timer', () => {
    const { saved, restored } = roundTrip(() => {});
    expect(restored).toEqual(saved);
  });

  it('round-trips a done timer', () => {
    const { saved, restored } = roundTrip((clock, timer) => {
      timer.start();
      completeCurrentPhase(clock, timer);
    });
    expect(restored).toEqual(saved);
  });

  it('resumes a running timer whose end is still ahead', () => {
    const { clock, timer, settings } = setup();
    timer.start();
    clock.advance(MIN);
    const restored = createTimer({ clock, settings });
    restored.restore(timer.snapshot(), clock.now());
    expect(restored.snapshot().status).toBe('running');
    expect(restored.snapshot().remainingMs).toBe(24 * MIN);
  });

  it('lands paused at the next phase after a long absence', () => {
    const { clock, timer, settings } = setup();
    timer.start();
    const saved = timer.snapshot();
    clock.set(saved.endsAtWall + 30 * MIN);
    /** @type {any[]} */
    const events = [];
    const restored = createTimer({ clock, settings, onEvent: (event) => events.push(event) });
    const snapshot = restored.restore(saved, clock.now());

    expect(snapshot).toMatchObject({
      phase: 'short',
      status: 'paused',
      rounds: 1,
      remainingMs: 5 * MIN,
    });
    expect(events.map((event) => event.type)).toEqual(['phase-complete', 'missed-while-away']);
  });

  it('does not report missed-while-away for a one-second absence', () => {
    const { clock, timer, settings } = setup();
    timer.start();
    const saved = timer.snapshot();
    clock.set(saved.endsAtWall + 1_000);
    /** @type {any[]} */
    const events = [];
    const restored = createTimer({ clock, settings, onEvent: (event) => events.push(event) });
    const snapshot = restored.restore(saved, clock.now());

    expect(snapshot).toMatchObject({ phase: 'short', status: 'paused' });
    expect(events.map((event) => event.type)).toEqual(['phase-complete']);
  });

  it('does not report missed-while-away at exactly one phase duration', () => {
    const { clock, timer, settings } = setup();
    timer.start();
    const saved = timer.snapshot();
    clock.set(saved.endsAtWall + 25 * MIN);
    /** @type {any[]} */
    const events = [];
    const restored = createTimer({ clock, settings, onEvent: (event) => events.push(event) });
    restored.restore(saved, clock.now());
    expect(events.map((event) => event.type)).toEqual(['phase-complete']);
  });

  it('reports at most one completion and one missed notice after eight hours', () => {
    const { clock, timer, settings } = setup();
    timer.start();
    const saved = timer.snapshot();
    clock.set(saved.endsAtWall + 8 * 60 * MIN);
    /** @type {any[]} */
    const events = [];
    const restored = createTimer({ clock, settings, onEvent: (event) => events.push(event) });
    const snapshot = restored.restore(saved, clock.now());

    expect(events.filter((event) => event.type === 'phase-complete')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'missed-while-away')).toHaveLength(1);
    expect(snapshot).toMatchObject({ phase: 'short', status: 'paused', rounds: 1 });
  });

  it('resets a corrupt snapshot to the initial state without events', () => {
    for (const corrupt of [null, {}, { phase: 'nap', status: 'running' }, { phase: 'focus' }]) {
      const { clock, timer, events } = setup();
      const snapshot = timer.restore(corrupt, clock.now());
      expect(snapshot).toMatchObject({ phase: 'focus', status: 'idle', rounds: 0 });
      expect(events).toHaveLength(0);
    }
  });

  it('degrades a running snapshot with no end instant to paused', () => {
    const { clock, timer } = setup();
    timer.restore(
      {
        phase: 'short',
        status: 'running',
        remainingMs: 2 * MIN,
        durationMs: 5 * MIN,
        endsAtWall: null,
        rounds: 1,
        settingsRevision: 3,
      },
      clock.now()
    );
    expect(timer.snapshot()).toMatchObject({
      phase: 'short',
      status: 'paused',
      remainingMs: 2 * MIN,
      settingsRevision: 3,
    });
  });

  it('fills missing fields from the current settings', () => {
    const { clock, timer } = setup();
    timer.restore({ phase: 'short', status: 'paused' }, clock.now());
    expect(timer.snapshot()).toMatchObject({
      phase: 'short',
      status: 'paused',
      durationMs: 5 * MIN,
      remainingMs: 5 * MIN,
      rounds: 0,
    });
  });

  it('uses the clock when now is not finite', () => {
    const { clock, timer, settings } = setup();
    timer.start();
    const restored = createTimer({ clock, settings });
    restored.restore(timer.snapshot(), Number.NaN);
    expect(restored.snapshot().status).toBe('running');
  });
});

describe('deterministic replay', () => {
  it('produces the same snapshots and events for the same inputs', () => {
    const run = () => {
      const clock = createFakeClock(0);
      /** @type {any[]} */
      const events = [];
      const timer = createTimer({
        clock,
        settings: SETTINGS,
        onEvent: (event) => events.push(event.type),
      });
      timer.start();
      clock.set(5 * MIN);
      timer.tick(clock.now());
      timer.pause();
      clock.set(6 * MIN);
      timer.start();
      clock.set(30 * MIN);
      timer.tick(clock.now());
      return { snapshots: timer.snapshot(), events };
    };
    expect(run()).toEqual(run());
  });
});
