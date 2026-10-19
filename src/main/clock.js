'use strict';

/**
 * The one clock the main process reads.
 *
 * Production uses a zero offset. Tests move the offset through
 * `src/main/test-support.js`, so the timer observes a different instant without
 * waiting and without a second time path. The offset is data, not a branch.
 */

/**
 * @param {{ offsetMs?: number }} [options]
 */
function createClock({ offsetMs = 0 } = {}) {
  let offset = Number.isFinite(offsetMs) ? offsetMs : 0;

  return {
    /** The current instant, as milliseconds since the epoch. */
    now() {
      return Date.now() + offset;
    },
    /** The current offset from the system clock, in milliseconds. */
    get offsetMs() {
      return offset;
    },
    /** Replace the offset. Non-finite values leave it unchanged. */
    setOffset(ms) {
      if (Number.isFinite(ms)) offset = ms;
      return offset;
    },
    /** Move the offset forward (or backward) by `ms`. */
    advance(ms) {
      if (Number.isFinite(ms)) offset += ms;
      return offset;
    },
    /** Set the clock to an absolute instant, as milliseconds since the epoch. */
    setNow(ms) {
      if (Number.isFinite(ms)) offset = ms - Date.now();
      return offset;
    },
  };
}

module.exports = { createClock };
