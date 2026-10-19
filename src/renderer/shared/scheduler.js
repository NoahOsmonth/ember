/**
 * The renderer's single scheduler.
 *
 * Two loops, both idle unless asked:
 *  - a tick loop for text that only needs second granularity;
 *  - a frame loop for values that are actually moving.
 *
 * Nothing here polls on a fixed sub-second interval. The widget starts the
 * loops while a phase is running and stops both the moment it is not, which is
 * what keeps a paused, always-on-top window close to zero CPU.
 */

/**
 * @param {{
 *   onTick?: () => void,
 *   onFrame?: () => void,
 *   tickHz?: number,
 *   now?: () => number
 * }} [options]
 */
export function createScheduler({
  onTick = () => {},
  onFrame = () => {},
  tickHz = 1,
  now = () => Date.now(),
} = {}) {
  let tickMs = 1000 / normalHz(tickHz);
  let tickTimer = null;
  let ticking = false;
  let frameHandle = null;
  let animating = false;

  const requestFrame =
    typeof globalThis.requestAnimationFrame === 'function'
      ? (callback) => globalThis.requestAnimationFrame(callback)
      : (callback) => globalThis.setTimeout(() => callback(now()), 16);
  const cancelFrame =
    typeof globalThis.cancelAnimationFrame === 'function'
      ? (handle) => globalThis.cancelAnimationFrame(handle)
      : (handle) => globalThis.clearTimeout(handle);

  function scheduleTick() {
    tickTimer = globalThis.setTimeout(() => {
      tickTimer = null;
      if (!ticking) return;
      try {
        onTick();
      } finally {
        if (ticking) scheduleTick();
      }
    }, tickMs);
  }

  function frame() {
    frameHandle = null;
    if (!animating) return;
    try {
      onFrame();
    } finally {
      if (animating) frameHandle = requestFrame(frame);
    }
  }

  function startTicks() {
    if (ticking) return;
    ticking = true;
    scheduleTick();
  }

  function stopTicks() {
    ticking = false;
    if (tickTimer !== null) {
      globalThis.clearTimeout(tickTimer);
      tickTimer = null;
    }
  }

  function requestFrames() {
    if (animating) return;
    animating = true;
    frameHandle = requestFrame(frame);
  }

  function stopFrames() {
    animating = false;
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
  }

  function stop() {
    stopTicks();
    stopFrames();
  }

  return {
    /** Change the tick cadence; a running loop restarts at the new rate. */
    setTickHz(hz) {
      const next = normalHz(hz);
      if (next === 1000 / tickMs) return;
      tickMs = 1000 / next;
      if (ticking) {
        stopTicks();
        startTicks();
      }
    },
    startTicks,
    stopTicks,
    requestFrames,
    stopFrames,
    stop,
    isTicking: () => ticking,
    isAnimating: () => animating,
  };
}

/**
 * @param {number} hz
 * @returns {number}
 */
function normalHz(hz) {
  return Number.isFinite(hz) && hz > 0 ? hz : 1;
}
