/**
 * The canonical Ember settings document.
 *
 * Pure ESM module: no Electron, no DOM, no filesystem, no ambient clock.
 * `normalize(raw)` is the single answer to "what is a valid document" and it
 * never throws, whatever bytes the caller hands it.
 */

import { themeNames } from './themes.js';

/** Schema version written by this build. */
export const CURRENT_VERSION = 1;

/** Themes the renderer knows how to paint, in picker order. */
export const THEMES = Object.freeze(themeNames());

/** Documented clamp ranges, used by validation and by the settings UI. */
export const LIMITS = Object.freeze({
  'durations.focus': Object.freeze({ min: 1, max: 180, integer: true }),
  'durations.short': Object.freeze({ min: 1, max: 60, integer: true }),
  'durations.long': Object.freeze({ min: 1, max: 120, integer: true }),
  rounds: Object.freeze({ min: 1, max: 12, integer: true }),
  volume: Object.freeze({ min: 0, max: 1, integer: false }),
  opacity: Object.freeze({ min: 0.2, max: 1, integer: false }),
});

/** The document a fresh install starts from. Frozen; normalize always copies. */
export const defaults = Object.freeze({
  schemaVersion: CURRENT_VERSION,
  durations: Object.freeze({ focus: 25, short: 5, long: 15 }),
  rounds: 4,
  autoBreak: true,
  autoFocus: false,
  sound: true,
  volume: 0.6,
  notify: true,
  theme: 'dusk',
  opacity: 0.62,
  mini: false,
  onTop: true,
  x: null,
  y: null,
  tutorialSeen: false,
  timer: null,
});

const BOOLEAN_PATHS = [
  'autoBreak',
  'autoFocus',
  'sound',
  'notify',
  'mini',
  'onTop',
  'tutorialSeen',
];
const NUMBER_PATHS = ['rounds', 'volume', 'opacity'];
const POSITION_PATHS = ['x', 'y'];

/**
 * Ordered migrations. Each entry upgrades a document from `from` to `to`.
 * Version 0 is the pre-release prototype shape: two duration fields carried
 * different names and were flattened onto the root object.
 */
export const migrations = Object.freeze([
  Object.freeze({
    from: 0,
    to: 1,
    migrate(doc) {
      const next = { ...doc, schemaVersion: 1 };
      if (next.pomodoro !== undefined) {
        next.durations = { ...(next.durations || {}), focus: next.pomodoro };
        delete next.pomodoro;
      }
      if (next.break !== undefined) {
        next.durations = { ...(next.durations || {}), short: next.break };
        delete next.break;
      }
      return next;
    },
  }),
]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clone = (value) => JSON.parse(JSON.stringify(value));

const issue = (path, code, detail) => ({ path, code, detail });

function getPath(doc, path) {
  return path.split('.').reduce((acc, key) => (isPlainObject(acc) ? acc[key] : undefined), doc);
}

function setPath(doc, path, value) {
  const keys = path.split('.');
  let cursor = doc;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!isPlainObject(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  return doc;
}

function coerceNumber(raw, limits) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false };
  let value = limits.integer ? Math.round(raw) : raw;
  if (value < limits.min) return { ok: true, value: limits.min, clamped: true };
  if (value > limits.max) return { ok: true, value: limits.max, clamped: true };
  return { ok: true, value };
}

/**
 * Normalize any input into a valid document.
 *
 * @param {unknown} raw whatever was read from disk
 * @returns {{ value: any, issues: Array<{ path: string, code: string, detail: string }> }}
 */
export function normalize(raw) {
  const issues = [];
  if (!isPlainObject(raw)) {
    issues.push(issue('', 'not-object', 'document is not a JSON object; using defaults'));
    return { value: clone(defaults), issues };
  }

  let doc = { ...raw };
  let version = doc.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) version = 0;

  if (version > CURRENT_VERSION) {
    issues.push(
      issue(
        'schemaVersion',
        'newer-version',
        `document version ${version} is newer than supported version ${CURRENT_VERSION}`
      )
    );
    return { value: clone(defaults), issues };
  }

  for (const migration of migrations) {
    if (version === migration.from) {
      doc = migration.migrate(doc);
      version = migration.to;
    }
  }

  const value = clone(defaults);
  value.schemaVersion = CURRENT_VERSION;

  for (const path of ['durations.focus', 'durations.short', 'durations.long', ...NUMBER_PATHS]) {
    const limits = LIMITS[path];
    const rawValue = getPath(doc, path);
    if (rawValue === undefined) continue;
    const result = coerceNumber(rawValue, limits);
    if (!result.ok) {
      issues.push(issue(path, 'invalid-type', `expected a number, got ${typeof rawValue}`));
      continue;
    }
    if (result.clamped) {
      issues.push(
        issue(path, 'clamped', `clamped to ${result.value} (allowed ${limits.min}..${limits.max})`)
      );
    }
    setPath(value, path, result.value);
  }

  for (const path of BOOLEAN_PATHS) {
    const rawValue = getPath(doc, path);
    if (rawValue === undefined) continue;
    if (typeof rawValue !== 'boolean') {
      issues.push(issue(path, 'invalid-type', `expected a boolean, got ${typeof rawValue}`));
      continue;
    }
    setPath(value, path, rawValue);
  }

  if (doc.theme !== undefined) {
    if (typeof doc.theme === 'string' && THEMES.includes(doc.theme)) value.theme = doc.theme;
    else issues.push(issue('theme', 'invalid-type', 'expected one of ' + THEMES.join(', ')));
  }

  for (const path of POSITION_PATHS) {
    const rawValue = doc[path];
    if (rawValue === undefined) continue;
    if (rawValue === null || (typeof rawValue === 'number' && Number.isFinite(rawValue))) {
      value[path] = rawValue;
    } else {
      issues.push(issue(path, 'invalid-type', 'expected a finite number or null'));
    }
  }

  if (doc.timer !== undefined) {
    if (doc.timer === null) value.timer = null;
    else if (isPlainObject(doc.timer)) value.timer = clone(doc.timer);
    else issues.push(issue('timer', 'invalid-type', 'expected a timer snapshot object or null'));
  }

  for (const key of Object.keys(doc)) {
    if (!(key in defaults)) issues.push(issue(key, 'unknown-key', 'key is not part of the schema'));
  }

  return { value, issues };
}
