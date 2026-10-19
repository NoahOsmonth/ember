/**
 * The timer state machine (capability: timer-core).
 *
 * Pure and host-driven: it never schedules anything and never reads the system
 * clock. The host calls `tick(now)`; remaining time is always derived from the
 * phase's end instant, so a suspended machine wakes with the correct value.
 */

const MINUTE_MS = 60_000;
const PHASES = ['focus', 'short', 'long'];
const STATUSES = ['idle', 'running', 'paused', 'done'];
const DEFAULT_DURATIONS = { focus: 25, short: 5, long: 15 };

/**
 * @typedef {'focus'|'short'|'long'} TimerPhase
 * @typedef {'idle'|'running'|'paused'|'done'} TimerStatus
 * @typedef {object} TimerSettings
 * @property {{ focus: number, short: number, long: number }} durations
 * @property {number} rounds
 * @property {boolean} autoBreak
 * @property {boolean} autoFocus
 * @typedef {object} TimerSnapshot
 * @property {TimerPhase} phase
 * @property {TimerStatus} status
 * @property {number} remainingMs
 * @property {number} durationMs
 * @property {number|null} endsAtWall
 * @property {number} rounds
 * @property {number} settingsRevision
 * @typedef {object} TimerEvent
 * @property {'phase-started'|'phase-complete'|'missed-while-away'} type
 * @property {TimerPhase} [completedPhase]
 * @property {TimerSnapshot} snapshot
 * @typedef {object} Timer
 * @property {() => TimerSnapshot} start
 * @property {() => TimerSnapshot} pause
 * @property {() => TimerSnapshot} toggle
 * @property {() => TimerSnapshot} skip
 * @property {() => TimerSnapshot} reset
 * @property {(now: number) => TimerSnapshot} tick
 * @property {(settings: any) => TimerSnapshot} applySettings
 * @property {() => TimerSnapshot} snapshot
 * @property {(saved: any, now?: number) => TimerSnapshot} restore
 * @property {(listener: (event: TimerEvent) => void) => (() => void)} subscribe
 */

/**
 * @param {any} input
 * @returns {TimerSettings}
 */
function normalizeSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  const durations =
    source.durations && typeof source.durations === 'object' ? source.durations : {};
  const minutes = (key, fallback) => {
    const value = Number(durations[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const rounds = Number(source.rounds);
  return {
    durations: {
      focus: minutes('focus', DEFAULT_DURATIONS.focus),
      short: minutes('short', DEFAULT_DURATIONS.short),
      long: minutes('long', DEFAULT_DURATIONS.long),
    },
    rounds: Number.isFinite(rounds) && rounds >= 1 ? Math.floor(rounds) : 4,
    autoBreak: typeof source.autoBreak === 'boolean' ? source.autoBreak : true,
    autoFocus: typeof source.autoFocus === 'boolean' ? source.autoFocus : false,
  };
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {{ clock?: { now: () => number }, settings?: any, onEvent?: (event: TimerEvent) => void }} [options]
 * @returns {Timer}
 */
function createTimer({ clock, settings: initialSettings, onEvent } = {}) {
  const time = clock && typeof clock.now === 'function' ? clock : { now: () => 0 };
  let settings = normalizeSettings(initialSettings);
  let settingsRevision = 0;
  /** @type {TimerPhase} */
  let phase = 'focus';
  /** @type {TimerStatus} */
  let status = 'idle';
  let phaseDurationMs = settings.durations.focus * MINUTE_MS;
  let remainingMs = phaseDurationMs;
  let endsAtWall = null;
  let rounds = 0;
  let lastNow = time.now();
  const listeners = [];

  if (typeof onEvent === 'function') listeners.push(onEvent);

  /** @param {TimerPhase} name */
  function durationFor(name) {
    return settings.durations[name] * MINUTE_MS;
  }

  /** @param {TimerEvent} event */
  function emit(event) {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // A bad listener must not take the timer down.
      }
    }
  }

  /** @returns {TimerSnapshot} */
  function snapshot() {
    const remaining =
      status === 'running' && endsAtWall !== null
        ? clamp(endsAtWall - lastNow, 0, phaseDurationMs)
        : clamp(remainingMs, 0, phaseDurationMs);
    return {
      phase,
      status,
      remainingMs: remaining,
      durationMs: phaseDurationMs,
      endsAtWall: status === 'running' ? endsAtWall : null,
      rounds,
      settingsRevision,
    };
  }

  /**
   * Move to the phase that follows a completion, without emitting. The caller
   * decides whether the next phase auto-starts and emits the events.
   */
  /** @param {TimerPhase} completed */
  function selectNextAfterCompletion(completed) {
    if (completed === 'focus') {
      rounds += 1;
      phase = rounds >= settings.rounds ? 'long' : 'short';
    } else {
      if (completed === 'long') rounds = 0;
      phase = 'focus';
    }
    phaseDurationMs = durationFor(phase);
    remainingMs = phaseDurationMs;
    endsAtWall = null;
    status = 'done';
  }

  /** @param {number} now */
  function startSelected(now) {
    status = 'running';
    endsAtWall = now + remainingMs;
    emit({ type: 'phase-started', snapshot: snapshot() });
  }

  function start() {
    if (status === 'running') return snapshot();
    if (status === 'idle' || status === 'paused' || status === 'done') {
      lastNow = time.now();
      startSelected(lastNow);
    }
    return snapshot();
  }

  function pause() {
    if (status !== 'running') return snapshot();
    lastNow = time.now();
    remainingMs = clamp(endsAtWall - lastNow, 0, phaseDurationMs);
    endsAtWall = null;
    status = 'paused';
    return snapshot();
  }

  function toggle() {
    return status === 'running' ? pause() : start();
  }

  function reset() {
    phase = 'focus';
    status = 'idle';
    rounds = 0;
    phaseDurationMs = durationFor('focus');
    remainingMs = phaseDurationMs;
    endsAtWall = null;
    lastNow = time.now();
    return snapshot();
  }

  function skip() {
    if (status !== 'running' && status !== 'paused') return snapshot();
    lastNow = time.now();
    const completed = phase;
    if (completed === 'long') rounds = 0;
    phase = completed === 'focus' ? 'short' : 'focus';
    phaseDurationMs = durationFor(phase);
    remainingMs = phaseDurationMs;
    endsAtWall = null;
    status = 'idle';
    const auto = phase === 'focus' ? settings.autoFocus : settings.autoBreak;
    if (auto) startSelected(lastNow);
    return snapshot();
  }

  /** @param {number} now */
  function tick(now) {
    if (finite(now)) lastNow = now;
    if (status !== 'running' || endsAtWall === null) return snapshot();

    if (endsAtWall - lastNow > 0) {
      remainingMs = clamp(endsAtWall - lastNow, 0, phaseDurationMs);
      return snapshot();
    }

    const completed = phase;
    selectNextAfterCompletion(completed);
    const auto = phase === 'focus' ? settings.autoFocus : settings.autoBreak;
    if (auto) {
      status = 'running';
      endsAtWall = lastNow + phaseDurationMs;
    }
    emit({ type: 'phase-complete', completedPhase: completed, snapshot: snapshot() });
    if (auto) emit({ type: 'phase-started', snapshot: snapshot() });
    return snapshot();
  }

  /** @param {any} next */
  function applySettings(next) {
    settings = normalizeSettings(next);
    settingsRevision += 1;
    if (status === 'idle' || status === 'done') {
      phaseDurationMs = durationFor(phase);
      remainingMs = phaseDurationMs;
      endsAtWall = null;
    }
    return snapshot();
  }

  /**
   * @param {any} saved
   * @param {number} [now]
   */
  function restore(saved, now) {
    const at = finite(now) ? now : time.now();
    lastNow = at;

    if (
      !saved ||
      typeof saved !== 'object' ||
      !PHASES.includes(saved.phase) ||
      !STATUSES.includes(saved.status)
    ) {
      phase = 'focus';
      status = 'idle';
      rounds = 0;
      settingsRevision = 0;
      phaseDurationMs = durationFor('focus');
      remainingMs = phaseDurationMs;
      endsAtWall = null;
      return snapshot();
    }

    phase = saved.phase;
    status = saved.status;
    rounds = finite(saved.rounds) ? Math.max(0, Math.floor(saved.rounds)) : 0;
    settingsRevision = finite(saved.settingsRevision) ? saved.settingsRevision : settingsRevision;
    phaseDurationMs =
      finite(saved.durationMs) && saved.durationMs > 0 ? saved.durationMs : durationFor(phase);
    remainingMs = finite(saved.remainingMs)
      ? clamp(saved.remainingMs, 0, phaseDurationMs)
      : phaseDurationMs;
    endsAtWall = finite(saved.endsAtWall) ? saved.endsAtWall : null;

    if (status === 'running' && endsAtWall === null) {
      status = 'paused';
    }

    if (status !== 'running' || endsAtWall === null) return snapshot();

    const remaining = endsAtWall - at;
    if (remaining > 0) {
      remainingMs = remaining;
      return snapshot();
    }

    const completed = phase;
    const completedDuration = phaseDurationMs;
    const away = at - endsAtWall;
    selectNextAfterCompletion(completed);
    status = 'paused';
    endsAtWall = null;
    remainingMs = phaseDurationMs;
    emit({ type: 'phase-complete', completedPhase: completed, snapshot: snapshot() });
    if (away > completedDuration) emit({ type: 'missed-while-away', snapshot: snapshot() });
    return snapshot();
  }

  /**
   * @param {(event: TimerEvent) => void} listener
   * @returns {() => void}
   */
  function subscribe(listener) {
    if (typeof listener === 'function') listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  }

  return {
    start,
    pause,
    toggle,
    skip,
    reset,
    tick,
    applySettings,
    snapshot,
    restore,
    subscribe,
  };
}

export { createTimer, PHASES, STATUSES };
