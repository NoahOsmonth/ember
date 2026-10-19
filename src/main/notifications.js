'use strict';

/**
 * Phase-completion notifications (capability: notifications).
 *
 * The toast belongs to the main process: the widget may be hidden when a phase
 * ends, and a renderer-owned `Notification` cannot outlive its window. The last
 * instance is retained because an unreferenced Electron notification can be
 * garbage-collected before the shell shows it.
 *
 * `shouldSignal` comes from `src/core/quiet-hours.js` (ESM), so this factory is
 * async and loads it once. Every path is wrapped: a refused or unsupported
 * notification is logged at debug and never delays the timer transition.
 */

const path = require('path');
const { pathToFileURL } = require('url');
const { Notification } = require('electron');

const HISTORY_LIMIT = 20;
const PHASE_LABELS = Object.freeze({
  focus: 'focus',
  short: 'short break',
  long: 'long break',
});

/**
 * @param {unknown} phase
 * @returns {string}
 */
function phaseLabel(phase) {
  return PHASE_LABELS[String(phase)] || String(phase || 'phase');
}

/**
 * Text for a completion that happened while the user was present.
 *
 * The title names the phase that ended and the body names the one that starts,
 * which is what the notifications spec requires.
 *
 * @param {{ completedPhase?: string, snapshot?: { phase?: string } } | null | undefined} event
 * @returns {{ title: string, body: string }}
 */
function completionText(event) {
  const completed = event && event.completedPhase;
  const next = event && event.snapshot && event.snapshot.phase;
  if (completed === 'focus') {
    return {
      title: 'Focus round done',
      body: `Time for a ${next && next !== 'focus' ? phaseLabel(next) : 'break'}.`,
    };
  }
  return { title: 'Break over', body: 'Ready for the next focus round.' };
}

/**
 * One sentence for a resume that crossed a phase boundary.
 *
 * @param {{ completedPhase?: string, snapshot?: { phase?: string } } | null | undefined} event
 * @returns {{ title: string, body: string }}
 */
function missedText(event) {
  const next = event && event.snapshot && event.snapshot.phase;
  const where = next ? ` at the start of the ${phaseLabel(next)}` : '';
  return {
    title: 'A phase ended while away',
    body: `Ember is paused${where}.`,
  };
}

/**
 * @param {{
 *   settings?: () => any,
 *   logger?: any,
 *   focusWidget?: () => any,
 *   isFocused?: () => boolean,
 *   now?: () => Date,
 *   NotificationClass?: any
 * }} [options]
 * @returns {Promise<{
 *   notifyPhaseComplete: (event: any) => { toast: boolean, chime: boolean },
 *   notifyMissed: (event: any) => { toast: boolean, chime: boolean },
 *   describe: () => { count: number, last: any, history: any[], supported: boolean },
 *   dispose: () => void
 * }>}
 */
async function createNotifier({
  settings = () => ({}),
  logger = null,
  focusWidget = () => {},
  isFocused = () => false,
  now = () => new Date(),
  NotificationClass = Notification,
} = {}) {
  const quietUrl = pathToFileURL(path.join(__dirname, '../core/quiet-hours.js')).href;
  const { shouldSignal } = await import(quietUrl);

  /** @type {any} */
  let last = null;
  let count = 0;
  /** @type {Array<{ title: string, body: string }>} */
  const history = [];

  const log = (level, message) => {
    if (logger && typeof logger[level] === 'function') logger[level](message);
  };

  /** The platform's own answer; a throwing probe is treated as unsupported. */
  function supported() {
    try {
      return typeof NotificationClass.isSupported === 'function'
        ? !!NotificationClass.isSupported()
        : true;
    } catch {
      return false;
    }
  }

  /** Evaluate the shared predicate; a failure suppresses rather than throws. */
  function signals() {
    try {
      return shouldSignal(now(), settings() || {}, isFocused());
    } catch (error) {
      log('debug', `signal decision failed (${error && error.message}); suppressing`);
      return { toast: false, chime: false };
    }
  }

  /**
   * @param {{ title: string, body: string }} content
   * @returns {boolean} whether the shell accepted the request
   */
  function present({ title, body }) {
    try {
      if (!supported()) {
        log('debug', 'notifications are not supported on this platform');
        return false;
      }
      const notification = new NotificationClass({ title, body, silent: true });
      // Keep the reference: an unreferenced notification can be collected
      // before the shell has drawn it.
      last = notification;
      if (typeof notification.on === 'function') {
        notification.on('click', () => {
          try {
            focusWidget();
          } catch (error) {
            log('debug', `notification click failed (${error && error.message})`);
          }
        });
      }
      notification.show();
      count += 1;
      history.push({ title, body });
      if (history.length > HISTORY_LIMIT) history.shift();
      log('debug', `notification shown: ${title}`);
      return true;
    } catch (error) {
      log('debug', `notification failed (${error && error.message})`);
      return false;
    }
  }

  /**
   * @param {any} event
   * @returns {{ toast: boolean, chime: boolean }}
   */
  function notifyPhaseComplete(event) {
    const decision = signals();
    if (!decision.toast) {
      log('debug', 'phase-completion signal suppressed');
      return decision;
    }
    present(completionText(event));
    return decision;
  }

  /**
   * @param {any} event
   * @returns {{ toast: boolean, chime: boolean }}
   */
  function notifyMissed(event) {
    const decision = signals();
    // A phase that ended while the machine was away is reported, never chimed:
    // replaying the sound after a resume is the storm change 9 removed.
    const missed = { ...decision, chime: false };
    if (!missed.toast) {
      log('debug', 'missed-phase signal suppressed');
      return missed;
    }
    present(missedText(event));
    return missed;
  }

  return {
    notifyPhaseComplete,
    notifyMissed,
    describe: () => ({
      count,
      last: history[history.length - 1] || null,
      history: [...history],
      retained: !!last,
      supported: supported(),
    }),
    dispose() {
      last = null;
    },
  };
}

module.exports = { createNotifier, completionText, missedText, phaseLabel, HISTORY_LIMIT };
