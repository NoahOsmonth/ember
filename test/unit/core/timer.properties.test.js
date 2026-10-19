import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTimer } from '../../../src/core/timer.js';
import { createFakeClock } from '../../helpers/clock.js';

const PHASES = ['focus', 'short', 'long'];
const STATUSES = ['idle', 'running', 'paused', 'done'];
const MIN = 60_000;

const settingsArbitrary = fc.record({
  durations: fc.record({
    focus: fc.integer({ min: 1, max: 120 }),
    short: fc.integer({ min: 1, max: 60 }),
    long: fc.integer({ min: 1, max: 90 }),
  }),
  rounds: fc.integer({ min: 1, max: 8 }),
  autoBreak: fc.boolean(),
  autoFocus: fc.boolean(),
});

const operationArbitrary = fc.oneof(
  fc.constant({ kind: 'start' }),
  fc.constant({ kind: 'pause' }),
  fc.constant({ kind: 'skip' }),
  fc.constant({ kind: 'reset' }),
  fc.integer({ min: 0, max: 2 * 60 * MIN }).map((ms) => ({ kind: 'tick', ms }))
);

const operationsArbitrary = fc.array(operationArbitrary, { maxLength: 24 });

function apply(timer, clock, operation) {
  if (operation.kind === 'tick') {
    clock.advance(operation.ms);
    timer.tick(clock.now());
    return;
  }
  timer[operation.kind]();
}

describe('timer properties', () => {
  it('always reports remaining within the phase duration', () => {
    fc.assert(
      fc.property(settingsArbitrary, operationsArbitrary, (settings, operations) => {
        const clock = createFakeClock(0);
        const timer = createTimer({ clock, settings });
        for (const operation of operations) {
          apply(timer, clock, operation);
          const snapshot = timer.snapshot();
          expect(PHASES).toContain(snapshot.phase);
          expect(STATUSES).toContain(snapshot.status);
          expect(snapshot.remainingMs).toBeGreaterThanOrEqual(0);
          expect(snapshot.remainingMs).toBeLessThanOrEqual(snapshot.durationMs);
          expect(snapshot.rounds).toBeGreaterThanOrEqual(0);
          if (snapshot.status === 'running') {
            expect(snapshot.endsAtWall).toBeTypeOf('number');
          } else {
            expect(snapshot.endsAtWall).toBeNull();
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it('restore(snapshot(), now) is idempotent', () => {
    fc.assert(
      fc.property(settingsArbitrary, operationsArbitrary, (settings, operations) => {
        const clock = createFakeClock(0);
        const timer = createTimer({ clock, settings });
        for (const operation of operations) apply(timer, clock, operation);

        const saved = JSON.parse(JSON.stringify(timer.snapshot()));
        const restored = createTimer({ clock, settings });
        restored.restore(saved, clock.now());
        expect(restored.snapshot()).toEqual(saved);
      }),
      { numRuns: 200 }
    );
  });

  it('rounds never decrease except on reset or during a long phase', () => {
    fc.assert(
      fc.property(settingsArbitrary, operationsArbitrary, (settings, operations) => {
        const clock = createFakeClock(0);
        const timer = createTimer({ clock, settings });
        for (const operation of operations) {
          const before = timer.snapshot();
          apply(timer, clock, operation);
          const after = timer.snapshot();
          if (after.rounds < before.rounds) {
            expect(operation.kind === 'reset' || before.phase === 'long').toBe(true);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it('a tick before the boundary never changes the phase', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 120 }),
        fc.integer({ min: 0, max: 119 * MIN + 59_999 }),
        (focusMinutes, elapsed) => {
          const duration = focusMinutes * MIN;
          if (elapsed >= duration) return;
          const clock = createFakeClock(0);
          const timer = createTimer({
            clock,
            settings: { durations: { focus: focusMinutes, short: 5, long: 15 }, rounds: 4 },
          });
          timer.start();
          clock.advance(elapsed);
          timer.tick(clock.now());
          const snapshot = timer.snapshot();
          expect(snapshot.phase).toBe('focus');
          expect(snapshot.status).toBe('running');
          expect(snapshot.remainingMs).toBe(duration - elapsed);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('restore never produces a negative remaining time', () => {
    const savedArbitrary = fc.record({
      phase: fc.oneof(fc.constantFrom(...PHASES), fc.constant('nap'), fc.constant(null)),
      status: fc.oneof(fc.constantFrom(...STATUSES), fc.constant('sleeping'), fc.constant(null)),
      remainingMs: fc.oneof(
        fc.integer({ min: -10 * MIN, max: 200 * MIN }),
        fc.constant(Number.NaN)
      ),
      durationMs: fc.oneof(fc.integer({ min: -MIN, max: 200 * MIN }), fc.constant(Number.NaN)),
      endsAtWall: fc.oneof(fc.integer({ min: -MIN, max: 10 * 60 * MIN }), fc.constant(null)),
      rounds: fc.oneof(fc.integer({ min: -5, max: 20 }), fc.constant(Number.NaN)),
      settingsRevision: fc.integer({ min: -5, max: 20 }),
    });

    fc.assert(
      fc.property(savedArbitrary, fc.integer({ min: 0, max: 10 * 60 * MIN }), (saved, now) => {
        const clock = createFakeClock(now);
        const timer = createTimer({ clock });
        const snapshot = timer.restore(saved, now);
        expect(snapshot.remainingMs).toBeGreaterThanOrEqual(0);
        expect(snapshot.remainingMs).toBeLessThanOrEqual(snapshot.durationMs);
      }),
      { numRuns: 300 }
    );
  });
});
