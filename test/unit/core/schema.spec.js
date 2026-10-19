import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CURRENT_VERSION,
  LIMITS,
  THEMES,
  defaults,
  migrations,
  normalize,
} from '../../../src/core/schema.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

describe('defaults', () => {
  it('is a frozen document at the current schema version', () => {
    expect(Object.isFrozen(defaults)).toBe(true);
    expect(defaults.schemaVersion).toBe(CURRENT_VERSION);
  });

  it('round-trips through normalize with no issues', () => {
    const { value, issues } = normalize(clone(defaults));
    expect(issues).toEqual([]);
    expect(value).toEqual(clone(defaults));
  });

  it('does not hand out the frozen object itself', () => {
    const { value } = normalize({});
    value.durations.focus = 99;
    expect(defaults.durations.focus).toBe(25);
  });
});

describe('field table', () => {
  const cases = [
    { path: 'durations.focus', good: 40, low: 0, high: 999, fallback: 25 },
    { path: 'durations.short', good: 7, low: 0, high: 999, fallback: 5 },
    { path: 'durations.long', good: 20, low: 0, high: 999, fallback: 15 },
    { path: 'rounds', good: 6, low: 0, high: 99, fallback: 4 },
    { path: 'volume', good: 0.3, low: -2, high: 5, fallback: 0.6 },
    { path: 'opacity', good: 0.8, low: 0.05, high: 4, fallback: 0.62 },
  ];

  const setPath = (path, value) => {
    const keys = path.split('.');
    const doc = {};
    let cursor = doc;
    keys.slice(0, -1).forEach((key) => {
      cursor[key] = {};
      cursor = cursor[key];
    });
    cursor[keys[keys.length - 1]] = value;
    return doc;
  };

  const readPath = (doc, path) =>
    path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), doc);

  for (const testCase of cases) {
    it(`accepts an in-range value for ${testCase.path}`, () => {
      const { value, issues } = normalize(setPath(testCase.path, testCase.good));
      expect(readPath(value, testCase.path)).toBe(testCase.good);
      expect(issues).toEqual([]);
    });

    it(`clamps ${testCase.path} below and above its range`, () => {
      const low = normalize(setPath(testCase.path, testCase.low));
      expect(readPath(low.value, testCase.path)).toBe(LIMITS[testCase.path].min);
      expect(low.issues.map((entry) => entry.code)).toEqual(['clamped']);

      const high = normalize(setPath(testCase.path, testCase.high));
      expect(readPath(high.value, testCase.path)).toBe(LIMITS[testCase.path].max);
      expect(high.issues.map((entry) => entry.code)).toEqual(['clamped']);
    });

    it(`falls back to the default for a wrongly typed ${testCase.path}`, () => {
      const { value, issues } = normalize(setPath(testCase.path, 'nope'));
      expect(readPath(value, testCase.path)).toBe(testCase.fallback);
      expect(issues).toEqual([
        expect.objectContaining({ path: testCase.path, code: 'invalid-type' }),
      ]);
    });
  }

  it('rounds fractional integer fields', () => {
    const { value } = normalize({ rounds: 5.4 });
    expect(value.rounds).toBe(5);
  });

  it('accepts every known theme and rejects the rest', () => {
    for (const theme of THEMES) {
      expect(normalize({ theme }).value.theme).toBe(theme);
    }
    const rejected = normalize({ theme: 'neon' });
    expect(rejected.value.theme).toBe('dusk');
    expect(rejected.issues[0]).toMatchObject({ path: 'theme', code: 'invalid-type' });
  });

  it('keeps booleans only when they are booleans', () => {
    const { value, issues } = normalize({ autoBreak: false, sound: 'yes', mini: 1 });
    expect(value.autoBreak).toBe(false);
    expect(value.sound).toBe(true);
    expect(value.mini).toBe(false);
    expect(issues.map((entry) => entry.path)).toEqual(['sound', 'mini']);
  });

  it('accepts finite coordinates and null, rejects anything else', () => {
    expect(normalize({ x: 12, y: null }).value).toMatchObject({ x: 12, y: null });
    expect(normalize({ x: null, y: -40 }).value).toMatchObject({ x: null, y: -40 });
    const bad = normalize({ x: 'left', y: Infinity });
    expect(bad.value).toMatchObject({ x: null, y: null });
    expect(bad.issues.map((entry) => entry.path)).toEqual(['x', 'y']);
  });

  it('reports unknown keys and drops them from the result', () => {
    const { value, issues } = normalize({ ...clone(defaults), themeColour: 'red' });
    expect(issues).toEqual([expect.objectContaining({ path: 'themeColour', code: 'unknown-key' })]);
    expect(value).not.toHaveProperty('themeColour');
  });

  it('returns defaults for a document from a newer version', () => {
    const { value, issues } = normalize({ schemaVersion: CURRENT_VERSION + 1, theme: 'mono' });
    expect(value).toEqual(clone(defaults));
    expect(issues).toEqual([
      expect.objectContaining({ path: 'schemaVersion', code: 'newer-version' }),
    ]);
  });
});

describe('migration from version 0', () => {
  it('is the only registered migration and lands on the current version', () => {
    expect(migrations.map((entry) => [entry.from, entry.to])).toEqual([[0, CURRENT_VERSION]]);
  });

  it('renames the prototype duration fields without producing issues', () => {
    const legacy = { pomodoro: 50, break: 10, rounds: 6, theme: 'mono' };
    const { value, issues } = normalize(legacy);
    expect(issues).toEqual([]);
    expect(value).toMatchObject({
      schemaVersion: CURRENT_VERSION,
      durations: { focus: 50, short: 10, long: 15 },
      rounds: 6,
      theme: 'mono',
    });
    expect(value).not.toHaveProperty('pomodoro');
    expect(value).not.toHaveProperty('break');
  });

  it('treats a missing or unusable schemaVersion as version 0', () => {
    for (const schemaVersion of [undefined, null, 'one', 1.5, -3]) {
      const { value } = normalize({ schemaVersion, pomodoro: 30 });
      expect(value.durations.focus).toBe(30);
      expect(value.schemaVersion).toBe(CURRENT_VERSION);
    }
  });
});

describe('normalize never throws', () => {
  it('handles non-object inputs by returning defaults', () => {
    for (const input of [null, undefined, 0, 'text', [], true, () => {}]) {
      const { value, issues } = normalize(input);
      expect(value).toEqual(clone(defaults));
      expect(issues).toEqual([expect.objectContaining({ code: 'not-object' })]);
    }
  });

  it('survives arbitrary JSON shapes', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (raw) => {
        const result = normalize(raw);
        expect(result).toBeTypeOf('object');
        expect(result.value.schemaVersion).toBe(CURRENT_VERSION);
        expect(Array.isArray(result.issues)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('survives a one megabyte random string', () => {
    const { randomBytes } = require('node:crypto');
    const huge = randomBytes(1024 * 1024).toString('base64');
    const { value, issues } = normalize(huge);
    expect(value).toEqual(clone(defaults));
    expect(issues).toEqual([expect.objectContaining({ code: 'not-object' })]);
  });

  it('survives arbitrary deeply nested objects', () => {
    fc.assert(
      fc.property(fc.object(), (raw) => {
        expect(() => normalize(raw)).not.toThrow();
      }),
      { numRuns: 200 }
    );
  });
});
