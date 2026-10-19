'use strict';

/**
 * The main-process timer service (capability: timer-ownership).
 *
 * One `createTimer` instance lives here for the whole application run. This
 * module is deliberately a thin adapter: it drives the core clock, persists the
 * snapshot through the settings store, and pushes it to every window. All timer
 * rules stay in `src/core/timer.js`; nothing here re-implements a transition.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const TICK_MS = 500;
const PERSIST_MS = 5_000;
const STRUCTURAL_KEYS = [
  'phase',
  'status',
  'durationMs',
  'endsAtWall',
  'rounds',
  'settingsRevision',
];

const structural = (snapshot) => STRUCTURAL_KEYS.map((key) => snapshot[key]).join('|');

/**
 * @param {{
 *   store: { get: () => any, set: (patch: any, value?: any) => any, flush: () => any },
 *   clock: { now: () => number },
 *   broadcast: (channel: string, payload: any) => void,
 *   logger?: { warn?: Function, error?: Function, info?: Function } | null,
 *   onPhaseComplete?: (event: any) => void
 * }} options
 * @returns {Promise<{
 *   start: () => any, pause: () => any, toggle: () => any, skip: () => any,
 *   reset: () => any, get: () => any, subscribe: () => { snapshot: any, notice: any },
 *   applySettings: (settings: any) => any,
 *   reconcile: (now: number, options?: { quiet?: boolean, awayMs?: number }) => any,
 *   reanchor: (remainingMs?: number) => any, awayFor: (ms: number) => number,
 *   persist: () => any, flush: () => void, dispose: () => void
 * }>}
 */
async function createTimerService({
  store,
  clock,
  broadcast,
  logger = null,
  onPhaseComplete = () => {},
}) {
  const timerUrl = pathToFileURL(path.join(__dirname, '../core/timer.js')).href;
  const { createTimer } = await import(timerUrl);

  let ticker = null;
  let lastPersistAt = 0;
  let queuedNotice = null;
  let quietReconcile = false;
  let quietCompletion = null;

  /** @param {any} event */
  function handleEvent(event) {
    if (event.type === 'phase-complete') {
      // A reconcile after a suspend must not play one chime per crossed phase.
      // Hold the completion and forward it once, marked quiet.
      if (quietReconcile) {
        quietCompletion = event;
        return;
      }
      notifyComplete(event);
    }
    if (event.type === 'missed-while-away' && !queuedNotice) queuedNotice = event;
  }

  /** @param {any} event */
  function notifyComplete(event) {
    try {
      onPhaseComplete(event);
    } catch (error) {
      if (logger && typeof logger.error === 'function') {
        logger.error(`timer notification hook failed: ${error && error.message}`);
      }
    }
  }

  const timer = createTimer({
    clock,
    settings: store.get(),
    onEvent: handleEvent,
  });

  function snapshot() {
    return timer.snapshot();
  }

  function persist() {
    const result = store.set('timer', snapshot());
    lastPersistAt = clock.now();
    if (result && Array.isArray(result.issues) && result.issues.length > 0 && logger) {
      const summary = result.issues.map((entry) => `${entry.path}: ${entry.code}`).join(', ');
      if (typeof logger.warn === 'function') logger.warn(`timer snapshot rejected: ${summary}`);
    }
    return result;
  }

  function publish() {
    broadcast('timer:snapshot', snapshot());
  }

  function syncTicker() {
    const running = snapshot().status === 'running';
    if (running && ticker === null) {
      ticker = setInterval(() => {
        const before = snapshot();
        const after = timer.tick(clock.now());
        publish();
        if (structural(before) !== structural(after) || clock.now() - lastPersistAt >= PERSIST_MS) {
          persist();
        }
        syncTicker();
      }, TICK_MS);
      if (typeof ticker.unref === 'function') ticker.unref();
    } else if (!running && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  /**
   * Run a core command and publish only when the snapshot's structural state
   * changed. A repeated start is a no-op in the core, so it does not produce a
   * second broadcast or write.
   *
   * @param {() => any} command
   */
  function run(command) {
    const before = snapshot();
    const after = command();
    if (structural(before) !== structural(after)) {
      publish();
      persist();
    }
    syncTicker();
    return after;
  }

  /**
   * Re-derive the timer from `endsAtWall` and the current instant.
   *
   * This is the same operation as startup restore, used by the power watcher
   * after a resume or a forward clock jump. It is idempotent: a second call
   * with the same `now` finds the same phase and advances nothing. With
   * `quiet`, a crossed phase still produces exactly one notification, marked
   * so the renderer skips the chime.
   *
   * @param {number} now
   * @param {{ quiet?: boolean, awayMs?: number }} [options]
   */
  function reconcile(now, { quiet = false, awayMs = 0 } = {}) {
    const at = Number.isFinite(now) ? now : clock.now();
    const before = snapshot();
    quietReconcile = quiet;
    quietCompletion = null;
    let after;
    try {
      after = timer.restore(before, at);
    } finally {
      quietReconcile = false;
    }

    if (quiet && quietCompletion) {
      const completion = { ...quietCompletion, quiet: true, awayMs: awayFor(awayMs) };
      quietCompletion = null;
      notifyComplete(completion);
    }

    publish();
    persist();
    syncTicker();
    return after;
  }

  /**
   * Rewrite the running phase's end instant so it keeps `remainingMs`.
   *
   * Used after a backwards clock jump: the phase keeps its remaining time
   * instead of gaining the jumped distance. A paused or idle timer has no end
   * instant to rewrite and is returned unchanged.
   *
   * @param {number} [remainingMs]
   */
  function reanchor(remainingMs) {
    const at = clock.now();
    const current = snapshot();
    if (current.status !== 'running') return current;
    const wanted = Number.isFinite(remainingMs) ? remainingMs : current.remainingMs;
    const remaining = Math.max(0, Math.min(current.durationMs, wanted));
    const next = timer.restore({ ...current, endsAtWall: at + remaining }, at);
    publish();
    persist();
    syncTicker();
    return next;
  }

  /**
   * Round an away duration for the notification payload.
   *
   * @param {number} ms
   * @returns {number} whole milliseconds, never negative
   */
  function awayFor(ms) {
    const value = Number(ms);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }

  /** Write the snapshot and drain the store, for OS shutdown. */
  function flush() {
    persist();
    if (store && typeof store.flush === 'function') store.flush();
  }

  // Restore once, before the first window exists. The core may emit
  // phase-complete and missed-while-away; the notice is held for the first
  // subscriber.
  const saved = store.get().timer;
  if (saved) {
    timer.restore(saved, clock.now());
    persist();
    syncTicker();
  }

  return {
    start: () => run(() => timer.start()),
    pause: () => run(() => timer.pause()),
    toggle: () => run(() => timer.toggle()),
    skip: () => run(() => timer.skip()),
    reset: () => run(() => timer.reset()),
    get: snapshot,
    subscribe() {
      const notice = queuedNotice;
      queuedNotice = null;
      return { snapshot: snapshot(), notice };
    },
    applySettings: (settings) => run(() => timer.applySettings(settings)),
    reconcile,
    reanchor,
    awayFor,
    persist,
    flush,
    dispose() {
      if (ticker !== null) {
        clearInterval(ticker);
        ticker = null;
      }
      persist();
    },
  };
}

module.exports = { createTimerService };
