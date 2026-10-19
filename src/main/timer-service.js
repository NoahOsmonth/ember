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
 *   applySettings: (settings: any) => any, persist: () => any, dispose: () => void
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

  /** @param {any} event */
  function handleEvent(event) {
    if (event.type === 'phase-complete') {
      try {
        onPhaseComplete(event);
      } catch (error) {
        if (logger && typeof logger.error === 'function') {
          logger.error(`timer notification hook failed: ${error && error.message}`);
        }
      }
    }
    if (event.type === 'missed-while-away' && !queuedNotice) queuedNotice = event;
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
    persist,
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
