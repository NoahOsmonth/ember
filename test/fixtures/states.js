/**
 * Timer states the visual harness can render without waiting for a real phase.
 *
 * These replace the widget's old `?demo=` hook. They are plain data: the
 * fixture gallery feeds them to the real renderer, and nothing in `src/` knows
 * this file exists.
 */

const MINUTE = 60_000;

const SETTINGS = Object.freeze({
  theme: 'dusk',
  rounds: 4,
  mini: false,
  locked: false,
  opacity: 0.62,
  notify: false,
  sound: false,
});

/**
 * @typedef {object} Fixture
 * @property {string} id
 * @property {object} snapshot
 * @property {object} settings
 */

/** @type {ReadonlyArray<Readonly<Fixture>>} */
export const FIXTURES = Object.freeze([
  Object.freeze({
    id: 'idle',
    snapshot: Object.freeze({
      phase: 'focus',
      status: 'idle',
      remainingMs: 25 * MINUTE,
      durationMs: 25 * MINUTE,
      endsAtWall: null,
      rounds: 0,
      settingsRevision: 0,
    }),
    settings: SETTINGS,
  }),
  Object.freeze({
    id: 'running',
    snapshot: Object.freeze({
      phase: 'focus',
      status: 'running',
      remainingMs: 15 * MINUTE,
      durationMs: 25 * MINUTE,
      endsAtWall: null,
      endsAtLabel: 'ends 10:25',
      rounds: 1,
      settingsRevision: 0,
    }),
    settings: SETTINGS,
  }),
  Object.freeze({
    id: 'paused',
    snapshot: Object.freeze({
      phase: 'focus',
      status: 'paused',
      remainingMs: 15 * MINUTE,
      durationMs: 25 * MINUTE,
      endsAtWall: null,
      rounds: 1,
      settingsRevision: 0,
    }),
    settings: SETTINGS,
  }),
  Object.freeze({
    id: 'long-break',
    snapshot: Object.freeze({
      phase: 'long',
      status: 'idle',
      remainingMs: 15 * MINUTE,
      durationMs: 15 * MINUTE,
      endsAtWall: null,
      rounds: 4,
      settingsRevision: 0,
    }),
    settings: SETTINGS,
  }),
  Object.freeze({
    id: 'one-bar',
    snapshot: Object.freeze({
      phase: 'focus',
      status: 'idle',
      remainingMs: MINUTE,
      durationMs: MINUTE,
      endsAtWall: null,
      rounds: 0,
      settingsRevision: 0,
    }),
    settings: SETTINGS,
  }),
  Object.freeze({
    id: 'full-bars',
    snapshot: Object.freeze({
      phase: 'focus',
      status: 'idle',
      remainingMs: 90 * MINUTE,
      durationMs: 90 * MINUTE,
      endsAtWall: null,
      rounds: 0,
      settingsRevision: 0,
    }),
    settings: SETTINGS,
  }),
]);

/**
 * @param {string | null} id
 * @returns {Readonly<Fixture>}
 */
export function fixtureById(id) {
  return FIXTURES.find((fixture) => fixture.id === id) || FIXTURES[0];
}
