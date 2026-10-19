/**
 * Ruler geometry: how a phase duration becomes bars, and how much of each bar
 * has elapsed. Pure — no clock, no DOM, no state between calls
 * (capability: ruler-rendering).
 */

/** The most bars the widget will ever draw. */
export const MAX_BARS = 30;

/** The smallest unit a bar can represent. */
export const MINUTE_MS = 60_000;

/**
 * The bar unit is the smallest whole minute that keeps the bar count at or
 * under `maxBars`, so a 25-minute phase uses one-minute bars and a 90-minute
 * phase uses three-minute bars.
 *
 * @param {number} durationMs phase length in milliseconds
 * @param {number} [maxBars] bar budget, defaults to 30
 * @returns {number} unit length in milliseconds
 */
export function unitFor(durationMs, maxBars = MAX_BARS) {
  const bars = Number.isFinite(maxBars) && maxBars >= 1 ? Math.floor(maxBars) : MAX_BARS;
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  return Math.max(MINUTE_MS, Math.ceil(duration / bars / MINUTE_MS) * MINUTE_MS);
}

/**
 * @typedef {object} RulerBar
 * @property {number} index position in the ruler, 0-based
 * @property {number} fill elapsed fraction of this bar, clamped to 0..1
 */

/**
 * @typedef {object} Ruler
 * @property {number} unitMs length of one bar in milliseconds
 * @property {number} count number of bars, always 1..maxBars
 * @property {RulerBar[]} bars one entry per bar, in order
 */

/**
 * Divide a phase into bars and fill them from elapsed time: bars wholly in the
 * past are 1, the bar holding the current moment is its elapsed fraction, and
 * bars still in the future are 0.
 *
 * @param {{ durationMs: number, elapsedMs?: number, maxBars?: number }} input
 * @returns {Ruler}
 */
export function computeRuler({ durationMs, elapsedMs = 0, maxBars = MAX_BARS }) {
  const limit = Number.isFinite(maxBars) && maxBars >= 1 ? Math.floor(maxBars) : MAX_BARS;
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const unitMs = unitFor(duration, limit);
  const count = Math.max(1, Math.min(limit, Math.ceil(duration / unitMs)));
  const elapsed = Number.isFinite(elapsedMs) ? Math.min(duration, Math.max(0, elapsedMs)) : 0;
  const full = Math.floor(elapsed / unitMs);
  const partial = (elapsed - full * unitMs) / unitMs;
  const bars = [];
  for (let index = 0; index < count; index++) {
    bars.push({ index, fill: index < full ? 1 : index === full ? partial : 0 });
  }
  return { unitMs, count, bars };
}
