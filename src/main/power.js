'use strict';

/**
 * Power, display and clock-jump handling (capabilities: power-events,
 * clock-jump-policy).
 *
 * The module owns every `powerMonitor` and `screen` subscription and exposes
 * the same handlers the OS events call, so the e2e test can drive a simulated
 * suspend through the shipped path instead of a stand-in.
 */

/** Wall/monotonic divergence that counts as a clock jump. Documented in ADR 0006. */
const JUMP_THRESHOLD_MS = 60_000;
const SAMPLE_MS = 1_000;

/** A monotonic reading that does not follow the system clock. */
function defaultMonotonic() {
  if (typeof process.hrtime.bigint === 'function') {
    return Number(process.hrtime.bigint() / 1_000_000n);
  }
  return Date.now();
}

/**
 * @param {{
 *   clock: { now: () => number },
 *   timer: any,
 *   windows?: { reassert?: () => void },
 *   logger?: { info?: Function, warn?: Function } | null,
 *   powerMonitor?: any,
 *   screen?: any,
 *   monotonic?: () => number,
 *   sampleMs?: number
 * }} options
 */
function createPowerWatcher({
  clock,
  timer,
  windows = {},
  logger = null,
  powerMonitor = null,
  screen = null,
  monotonic = defaultMonotonic,
  sampleMs = SAMPLE_MS,
}) {
  let suspendedAt = null;
  let suspendedWall = null;
  let lastWall = clock.now();
  let lastMono = monotonic();
  let disposed = false;

  /** @type {Array<[any, string, Function]>} */
  const subscriptions = [];

  function info(message) {
    if (logger && typeof logger.info === 'function') logger.info(message);
  }

  function warn(message) {
    if (logger && typeof logger.warn === 'function') logger.warn(message);
  }

  function reassert() {
    if (windows && typeof windows.reassert === 'function') windows.reassert();
  }

  function resetBaseline() {
    lastWall = clock.now();
    lastMono = monotonic();
  }

  function handleSuspend() {
    suspendedWall = clock.now();
    suspendedAt = monotonic();
    info('system suspended');
  }

  /**
   * How long the machine was away. The monotonic reading is preferred when it
   * moved because it ignores clock changes; some hosts stop that counter across
   * sleep, so the wall reading is the fallback.
   */
  function awaySinceSuspend(nowMono, nowWall) {
    const monoAway = suspendedAt === null ? 0 : Math.max(0, nowMono - suspendedAt);
    const wallAway = suspendedWall === null ? 0 : Math.max(0, nowWall - suspendedWall);
    return monoAway > 0 ? monoAway : wallAway;
  }

  /**
   * Recompute the timer from its end instant. Called by `resume` and by the
   * test channel, which supplies the simulated away duration.
   *
   * @param {number} [explicitAwayMs]
   */
  function handleResume(explicitAwayMs) {
    const nowWall = clock.now();
    const nowMono = monotonic();
    const away = Number.isFinite(explicitAwayMs)
      ? Math.max(0, Number(explicitAwayMs))
      : awaySinceSuspend(nowMono, nowWall);
    suspendedAt = null;
    suspendedWall = null;
    resetBaseline();
    if (!timer) return null;
    const snapshot = timer.reconcile(nowWall, { quiet: true, awayMs: away });
    reassert();
    info(`resumed after ${Math.round(away / 1000)} s away`);
    return snapshot;
  }

  function handleLock() {
    info('screen locked');
  }

  /**
   * Apply the clock-jump policy.
   *
   * @param {number} drift wall delta minus monotonic delta, in milliseconds
   * @param {number} previousWall the wall reading before the sample
   */
  function handleClockJump(drift, previousWall) {
    if (!timer) return;
    if (drift < 0) {
      const current = timer.get();
      if (current && current.status === 'running' && Number.isFinite(current.endsAtWall)) {
        // Use the pre-jump wall reading: the 500 ms ticker may already have
        // clamped its own view of the remaining time to the phase duration.
        const remaining = Math.max(
          0,
          Math.min(current.durationMs, current.endsAtWall - previousWall)
        );
        timer.reanchor(remaining);
      }
      warn(`clock moved backwards by ${Math.round(-drift / 1000)} s; re-anchored the phase`);
      return;
    }
    timer.reconcile(clock.now(), { quiet: true, awayMs: drift });
    warn(`clock moved forwards by ${Math.round(drift / 1000)} s; treated as elapsed`);
  }

  /** Compare wall and monotonic deltas; act when they diverge. */
  function sample() {
    const wall = clock.now();
    const mono = monotonic();
    const previousWall = lastWall;
    const wallDelta = wall - lastWall;
    const monoDelta = mono - lastMono;
    lastWall = wall;
    lastMono = mono;

    const drift = wallDelta - monoDelta;
    if (Math.abs(drift) <= JUMP_THRESHOLD_MS) return null;
    handleClockJump(drift, previousWall);
    return drift;
  }

  function handleDisplayChange() {
    reassert();
  }

  function handleShutdown() {
    info('system shutting down; flushing the timer snapshot');
    if (timer && typeof timer.flush === 'function') timer.flush();
  }

  /**
   * @param {any} emitter
   * @param {string} event
   * @param {Function} handler
   */
  function subscribe(emitter, event, handler) {
    if (!emitter || typeof emitter.on !== 'function') return;
    emitter.on(event, handler);
    subscriptions.push([emitter, event, handler]);
  }

  subscribe(powerMonitor, 'suspend', handleSuspend);
  subscribe(powerMonitor, 'resume', () => handleResume());
  subscribe(powerMonitor, 'lock-screen', handleLock);
  subscribe(powerMonitor, 'unlock-screen', reassert);
  subscribe(powerMonitor, 'shutdown', handleShutdown);
  subscribe(screen, 'display-metrics-changed', handleDisplayChange);

  const sampler = setInterval(sample, sampleMs);
  if (typeof sampler.unref === 'function') sampler.unref();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(sampler);
      for (const [emitter, event, handler] of subscriptions) {
        if (typeof emitter.removeListener === 'function') emitter.removeListener(event, handler);
        else if (typeof emitter.off === 'function') emitter.off(event, handler);
      }
      subscriptions.length = 0;
    },
    handleSuspend,
    handleResume,
    handleClockJump,
    handleDisplayChange,
    handleShutdown,
    sample,
  };
}

module.exports = { createPowerWatcher, JUMP_THRESHOLD_MS };
