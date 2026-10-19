import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { v } from '../../../src/core/validate.js';

const codes = (issues) => issues.map((entry) => entry.code);
const paths = (issues) => issues.map((entry) => entry.path);

describe('v.string', () => {
  it('accepts a string and rejects every other type', () => {
    const schema = v.string();
    expect(schema.check('hello')).toEqual([]);
    for (const value of [1, true, null, undefined, {}, []]) {
      expect(codes(schema.check(value))).toContain('type');
    }
  });

  it('enforces length bounds', () => {
    const schema = v.string({ minLength: 2, maxLength: 4 });
    expect(schema.check('ab')).toEqual([]);
    expect(codes(schema.check('a'))).toContain('min-length');
    expect(codes(schema.check('abcde'))).toContain('max-length');
  });
});

describe('v.number', () => {
  it('accepts finite numbers and rejects NaN, Infinity and non-numbers', () => {
    const schema = v.number();
    expect(schema.check(1.5)).toEqual([]);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined]) {
      expect(codes(schema.check(value))).toContain('type');
    }
  });

  it('enforces range and integer bounds', () => {
    const schema = v.number({ min: 0, max: 10, integer: true });
    expect(schema.check(0)).toEqual([]);
    expect(schema.check(10)).toEqual([]);
    expect(codes(schema.check(-1))).toContain('min');
    expect(codes(schema.check(11))).toContain('max');
    expect(codes(schema.check(1.5))).toContain('integer');
  });
});

describe('v.boolean and v.enum', () => {
  it('accepts only booleans', () => {
    const schema = v.boolean();
    expect(schema.check(true)).toEqual([]);
    expect(schema.check(false)).toEqual([]);
    for (const value of [0, 1, 'true', null, undefined]) {
      expect(codes(schema.check(value))).toContain('type');
    }
  });

  it('accepts only declared enum values', () => {
    const schema = v.enum(['focus', 'short', 'long']);
    expect(schema.check('focus')).toEqual([]);
    expect(codes(schema.check('break'))).toContain('enum');
    expect(codes(schema.check(null))).toContain('enum');
  });
});

describe('v.object', () => {
  const schema = v.object({
    name: v.string(),
    count: v.number({ min: 0 }),
    maybe: v.optional(v.string()),
  });

  it('accepts a matching object, with or without optional fields', () => {
    expect(schema.check({ name: 'a', count: 1 })).toEqual([]);
    expect(schema.check({ name: 'a', count: 1, maybe: 'b' })).toEqual([]);
  });

  it('rejects a missing required field, naming its path', () => {
    const issues = schema.check({ count: 1 });
    expect(codes(issues)).toContain('required');
    expect(paths(issues)).toContain('name');
  });

  it('rejects unknown keys in strict mode and allows them when not strict', () => {
    const issues = schema.check({ name: 'a', count: 1, extra: true });
    expect(codes(issues)).toContain('unknown-key');
    expect(paths(issues)).toContain('extra');
    const loose = v.object({ name: v.string() }, { strict: false });
    expect(loose.check({ name: 'a', extra: true })).toEqual([]);
  });

  it('rejects arrays and null as objects', () => {
    for (const value of [null, [], 'object', 1]) {
      expect(codes(schema.check(value))).toContain('type');
    }
  });

  it('walks nested objects with dotted paths', () => {
    const nested = v.object({ inner: v.object({ count: v.number({ min: 1 }) }) });
    const issues = nested.check({ inner: { count: 0 } });
    expect(paths(issues)).toContain('inner.count');
    expect(codes(issues)).toContain('min');
  });
});

describe('v.array', () => {
  it('accepts an array of the inner shape and rejects other values', () => {
    const schema = v.array(v.number({ integer: true }));
    expect(schema.check([1, 2, 3])).toEqual([]);
    for (const value of [{}, 'x', null, undefined]) {
      expect(codes(schema.check(value))).toContain('type');
    }
  });

  it('names the failing index and enforces maxLength', () => {
    const schema = v.array(v.string(), { maxLength: 2 });
    const issues = schema.check(['ok', 2, 'ok']);
    expect(paths(issues)).toContain('[1]');
    expect(codes(issues)).toContain('type');
    expect(codes(schema.check(['a', 'b', 'c']))).toContain('max-length');
  });
});

describe('v.optional', () => {
  it('allows undefined but not null', () => {
    const schema = v.optional(v.string());
    expect(schema.check(undefined)).toEqual([]);
    expect(codes(schema.check(null))).toContain('type');
  });
});

describe('validation properties', () => {
  const schema = v.object({
    name: v.string({ maxLength: 5 }),
    count: v.number({ min: 0, max: 10, integer: true }),
    flag: v.boolean(),
    mode: v.enum(['a', 'b']),
    tags: v.array(v.string(), { maxLength: 3 }),
    nested: v.object({ x: v.number() }),
    maybe: v.optional(v.string()),
  });

  it('never throws, and every failure names a path', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const issues = schema.check(value);
        for (const entry of issues) {
          expect(typeof entry.path).toBe('string');
          expect(typeof entry.code).toBe('string');
          expect(typeof entry.detail).toBe('string');
        }
        if (issues.length === 0) {
          expect(value).toBeTypeOf('object');
        } else {
          expect(issues.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 500 }
    );
  });
});
