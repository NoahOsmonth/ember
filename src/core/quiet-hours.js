/**
 * Quiet hours and the single signal decision.
 *
 * Pure ESM: no Electron, no DOM, no ambient clock. `isQuiet` takes the instant
 * from the caller so tests are deterministic and the app can use its injected
 * clock, and `shouldSignal` is the one place that decides whether a phase
 * completion is allowed to make a sound or show a toast.
 */

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/**
 * Parse a `HH:MM` clock time into minutes after local midnight.
 *
 * @param {unknown} value
 * @returns {number | null} minutes in 0..1439, or null when the value is not a time
 */
export function parseClockTime(value) {
  if (typeof value !== 'string') return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Canonical `HH:MM`, or null when the value is not a clock time.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeClockTime(value) {
  const minutes = parseClockTime(value);
  if (minutes === null) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Is `date` inside the configured quiet window?
 *
 * The start is inclusive and the end is exclusive. A window whose start is
 * later than its end crosses midnight (22:00–07:00 covers both 23:00 and 02:00).
 * A disabled or malformed window is never quiet, and an empty window
 * (`start === end`) is never quiet either.
 *
 * @param {Date | number} date the instant to test; a number is epoch milliseconds
 * @param {{ enabled?: boolean, start?: string, end?: string } | null | undefined} window
 * @returns {boolean}
 */
export function isQuiet(date, window) {
  if (!window || window.enabled !== true) return false;
  const start = parseClockTime(window.start);
  const end = parseClockTime(window.end);
  if (start === null || end === null || start === end) return false;

  const at = date instanceof Date ? date : new Date(date);
  const time = at.getTime();
  if (!Number.isFinite(time)) return false;

  const minutes = at.getHours() * 60 + at.getMinutes();
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

/**
 * Decide both phase-end signals once, so the toast and the chime cannot
 * disagree.
 *
 * - do-not-disturb and quiet hours silence everything;
 * - `notify` is the master switch (turning notifications off also stops the
 *   chime, which used to keep playing);
 * - `sound` gates the chime only;
 * - a focused widget suppresses the toast because the user can see the phase
 *   change, but keeps the chime.
 *
 * @param {Date | number} now
 * @param {{ notify?: boolean, sound?: boolean, doNotDisturb?: boolean, quietHours?: any } | null | undefined} settings
 * @param {boolean} [focused] whether the widget currently has focus
 * @returns {{ toast: boolean, chime: boolean }}
 */
export function shouldSignal(now, settings, focused = false) {
  const doc = settings || {};
  const silenced = doc.doNotDisturb === true || isQuiet(now, doc.quietHours);
  const enabled = doc.notify !== false;
  return {
    toast: enabled && !silenced && !focused,
    chime: enabled && !silenced && doc.sound !== false,
  };
}
