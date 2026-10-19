/**
 * The canonical Ember settings document.
 *
 * Pure ESM module: no Electron, no DOM, no filesystem, no ambient clock.
 * `normalize(raw)` is the single answer to "what is a valid document" and it
 * never throws, whatever bytes the caller hands it.
 */

import { themeNames } from './themes.js';
import { canonicalAccelerator } from './accelerators.js';
import { normalizeClockTime } from './quiet-hours.js';

/** Schema version written by this build. */
export const CURRENT_VERSION = 1;

/** Themes the renderer knows how to paint, in picker order. */
export const THEMES = Object.freeze(themeNames());

/** Background modes: automatic, forced transparent, forced opaque. */
export const BACKGROUNDS = Object.freeze(['auto', 'transparent', 'solid']);

/** Documented clamp ranges, used by validation and by the settings UI. */
export const LIMITS = Object.freeze({
  'durations.focus': Object.freeze({ min: 1, max: 180, integer: true }),
  'durations.short': Object.freeze({ min: 1, max: 60, integer: true }),
  'durations.long': Object.freeze({ min: 1, max: 120, integer: true }),
  rounds: Object.freeze({ min: 1, max: 12, integer: true }),
  volume: Object.freeze({ min: 0, max: 1, integer: false }),
  opacity: Object.freeze({ min: 0.2, max: 1, integer: false }),
});

/** The global shortcuts the app owns, in the order the settings window lists them. */
export const SHORTCUT_IDS = Object.freeze(['showHide', 'toggle', 'lock']);

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
  doNotDisturb: false,
  quietHours: Object.freeze({ enabled: false, start: '22:00', end: '07:00' }),
  theme: 'dusk',
  opacity: 0.62,
  mini: false,
  onTop: true,
  shortcuts: Object.freeze({
    showHide: 'Control+Alt+P',
    toggle: 'Control+Alt+Space',
    lock: 'Control+Alt+L',
  }),
  placement: null,
  render: Object.freeze({ background: 'auto' }),
  tutorialSeen: false,
  timer: null,
});

const BOOLEAN_PATHS = [
  'autoBreak',
  'autoFocus',
  'sound',
  'notify',
  'doNotDisturb',
  'mini',
  'onTop',
  'tutorialSeen',
];
const NUMBER_PATHS = ['rounds', 'volume', 'opacity'];
/** Pre-placement keys that normalize still accepts and converts. */
const LEGACY_KEYS = Object.freeze(['x', 'y', 'width', 'height', 'window']);

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
 * Turn a placement candidate into the canonical shape.
 *
 * The old document stored `{ x, y }` at the root; some prototype builds nested
 * it under `window`. Both are accepted, and the result always carries the full
 * `{ x, y, width, height, displayId, scaleFactor }` record.
 *
 * @param {unknown} raw
 * @returns {{ x: number, y: number, width: number, height: number, displayId: number | null, scaleFactor: number } | null}
 */
function normalizePlacement(raw) {
  if (!isPlainObject(raw)) return null;
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
  return {
    x: raw.x,
    y: raw.y,
    width:
      typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width >= 0 ? raw.width : 0,
    height:
      typeof raw.height === 'number' && Number.isFinite(raw.height) && raw.height >= 0
        ? raw.height
        : 0,
    displayId: Number.isInteger(raw.displayId) ? raw.displayId : null,
    scaleFactor:
      typeof raw.scaleFactor === 'number' && Number.isFinite(raw.scaleFactor) && raw.scaleFactor > 0
        ? raw.scaleFactor
        : 1,
  };
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

  if (doc.render !== undefined) {
    if (!isPlainObject(doc.render)) {
      issues.push(issue('render', 'invalid-type', 'expected an object'));
    } else {
      if (doc.render.background !== undefined) {
        if (BACKGROUNDS.includes(doc.render.background)) {
          value.render.background = doc.render.background;
        } else {
          issues.push(
            issue('render.background', 'invalid-type', 'expected one of ' + BACKGROUNDS.join(', '))
          );
        }
      }
      for (const key of Object.keys(doc.render)) {
        if (key !== 'background') {
          issues.push(issue(`render.${key}`, 'unknown-key', 'key is not part of the schema'));
        }
      }
    }
  }

  if (doc.quietHours !== undefined) {
    if (!isPlainObject(doc.quietHours)) {
      issues.push(issue('quietHours', 'invalid-type', 'expected an object'));
    } else {
      const raw = doc.quietHours;
      if (raw.enabled !== undefined) {
        if (typeof raw.enabled === 'boolean') value.quietHours.enabled = raw.enabled;
        else issues.push(issue('quietHours.enabled', 'invalid-type', 'expected a boolean'));
      }
      for (const key of ['start', 'end']) {
        if (raw[key] === undefined) continue;
        const time = normalizeClockTime(raw[key]);
        if (time === null) {
          issues.push(issue(`quietHours.${key}`, 'invalid-type', 'expected HH:MM'));
        } else {
          value.quietHours[key] = time;
        }
      }
      for (const key of Object.keys(raw)) {
        if (!['enabled', 'start', 'end'].includes(key)) {
          issues.push(issue(`quietHours.${key}`, 'unknown-key', 'key is not part of the schema'));
        }
      }
    }
  }

  if (doc.placement !== undefined) {
    if (doc.placement === null) {
      value.placement = null;
    } else {
      const placement = normalizePlacement(doc.placement);
      if (placement) value.placement = placement;
      else {
        issues.push(issue('placement', 'invalid-type', 'expected a placement object or null'));
      }
    }
  } else {
    // Convert the pre-placement shape once. After this write the document has
    // only `placement`, so a second normalize is a no-op.
    const candidates = isPlainObject(doc.window) ? [doc.window, doc] : [doc];
    for (const candidate of candidates) {
      const placement = normalizePlacement(candidate);
      if (placement) {
        value.placement = placement;
        break;
      }
    }
  }

  if (doc.shortcuts !== undefined) {
    if (!isPlainObject(doc.shortcuts)) {
      issues.push(issue('shortcuts', 'invalid-type', 'expected an object'));
    } else {
      for (const id of SHORTCUT_IDS) {
        const rawValue = doc.shortcuts[id];
        if (rawValue === undefined) continue;
        const accelerator = canonicalAccelerator(rawValue);
        if (accelerator === null) {
          issues.push(
            issue(`shortcuts.${id}`, 'invalid-accelerator', 'expected a parseable accelerator')
          );
          continue;
        }
        value.shortcuts[id] = accelerator;
      }
      for (const key of Object.keys(doc.shortcuts)) {
        if (!SHORTCUT_IDS.includes(key)) {
          issues.push(issue(`shortcuts.${key}`, 'unknown-key', 'key is not part of the schema'));
        }
      }
    }
  }

  // A hand-edited document can give two actions the same combination. The
  // later one falls back to its default; registration reports a conflict when
  // even that is taken.
  const seen = new Map();
  for (const id of SHORTCUT_IDS) {
    const accelerator = value.shortcuts[id];
    if (seen.has(accelerator)) {
      issues.push(
        issue(`shortcuts.${id}`, 'duplicate-accelerator', `same as ${seen.get(accelerator)}`)
      );
      value.shortcuts[id] = defaults.shortcuts[id];
    } else {
      seen.set(accelerator, id);
    }
  }

  if (doc.timer !== undefined) {
    if (doc.timer === null) value.timer = null;
    else if (isPlainObject(doc.timer)) value.timer = clone(doc.timer);
    else issues.push(issue('timer', 'invalid-type', 'expected a timer snapshot object or null'));
  }

  for (const key of Object.keys(doc)) {
    if (!(key in defaults) && !LEGACY_KEYS.includes(key)) {
      issues.push(issue(key, 'unknown-key', 'key is not part of the schema'));
    }
  }

  return { value, issues };
}
