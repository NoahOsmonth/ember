import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_BARS, MINUTE_MS, computeRuler, unitFor } from '../../../src/core/ruler.js';

const MIN = MINUTE_MS;
const fillsOf = (ruler) => ruler.bars.map((bar) => bar.fill);

describe('unitFor', () => {
  it('uses one-minute units for a 25-minute phase', () => {
    expect(unitFor(25 * MIN)).toBe(MIN);
  });

  it('grows the unit for a 90-minute phase', () => {
    expect(unitFor(90 * MIN)).toBe(3 * MIN);
  });

  it('never goes below one minute', () => {
    expect(unitFor(30_000)).toBe(MIN);
    expect(unitFor(0)).toBe(MIN);
    expect(unitFor(-5 * MIN)).toBe(MIN);
  });

  it('keeps every duration at or under the bar budget', () => {
    for (let minutes = 1; minutes <= 180; minutes++) {
      expect(Math.ceil((minutes * MIN) / unitFor(minutes * MIN))).toBeLessThanOrEqual(MAX_BARS);
    }
  });

  it('honours a caller-supplied budget', () => {
    expect(unitFor(10 * MIN, 5)).toBe(2 * MIN);
  });

  it('falls back to the default budget when the budget is unusable', () => {
    expect(unitFor(60 * MIN, 0)).toBe(unitFor(60 * MIN));
    expect(unitFor(60 * MIN, -3)).toBe(unitFor(60 * MIN));
    expect(unitFor(60 * MIN, Number.NaN)).toBe(unitFor(60 * MIN));
    expect(unitFor(60 * MIN, Number.POSITIVE_INFINITY)).toBe(unitFor(60 * MIN));
  });

  it('floors a fractional budget', () => {
    expect(unitFor(10 * MIN, 4.9)).toBe(unitFor(10 * MIN, 4));
  });
});

describe('computeRuler', () => {
  it('renders 25 bars of one minute for a 25-minute phase', () => {
    const ruler = computeRuler({ durationMs: 25 * MIN });
    expect(ruler.unitMs).toBe(MIN);
    expect(ruler.count).toBe(25);
    expect(ruler.bars).toHaveLength(25);
    expect(fillsOf(ruler).every((fill) => fill === 0)).toBe(true);
  });

  it('renders 30 bars of three minutes for a 90-minute phase', () => {
    const ruler = computeRuler({ durationMs: 90 * MIN });
    expect(ruler.unitMs).toBe(3 * MIN);
    expect(ruler.count).toBe(30);
  });

  it('renders one bar for a 30-second phase', () => {
    const ruler = computeRuler({ durationMs: 30_000 });
    expect(ruler.unitMs).toBe(MIN);
    expect(ruler.count).toBe(1);
    expect(fillsOf(ruler)).toEqual([0]);
  });

  it('renders one empty bar for a zero-length phase', () => {
    const ruler = computeRuler({ durationMs: 0 });
    expect(ruler.unitMs).toBe(MIN);
    expect(ruler.count).toBe(1);
    expect(fillsOf(ruler)).toEqual([0]);
  });

  it('renders one empty bar for a negative duration', () => {
    const ruler = computeRuler({ durationMs: -5 * MIN });
    expect(ruler.count).toBe(1);
    expect(fillsOf(ruler)).toEqual([0]);
  });

  it('fills completed bars and the boundary bar from elapsed time', () => {
    const ruler = computeRuler({ durationMs: 25 * MIN, elapsedMs: 12.5 * MIN });
    expect(fillsOf(ruler)).toEqual([...Array(12).fill(1), 0.5, ...Array(12).fill(0)]);
  });

  it('clamps every fill when elapsed time passes the duration', () => {
    const ruler = computeRuler({ durationMs: 25 * MIN, elapsedMs: 40 * MIN });
    expect(fillsOf(ruler).every((fill) => fill === 1)).toBe(true);
  });

  it('clamps every fill when elapsed time is negative', () => {
    const ruler = computeRuler({ durationMs: 25 * MIN, elapsedMs: -60_000 });
    expect(fillsOf(ruler).every((fill) => fill === 0)).toBe(true);
  });

  it('returns the same result for the same input', () => {
    const input = { durationMs: 50 * MIN, elapsedMs: 12 * MIN + 500 };
    expect(computeRuler(input)).toEqual(computeRuler(input));
  });

  it('falls back to the default budget when the budget is unusable', () => {
    const fallback = computeRuler({ durationMs: 60 * MIN });
    expect(computeRuler({ durationMs: 60 * MIN, maxBars: 0 })).toEqual(fallback);
    expect(computeRuler({ durationMs: 60 * MIN, maxBars: Number.NaN })).toEqual(fallback);
    expect(computeRuler({ durationMs: 60 * MIN, maxBars: Number.POSITIVE_INFINITY })).toEqual(
      fallback
    );
    expect(computeRuler({ durationMs: 60 * MIN, maxBars: 4.9 })).toEqual(
      computeRuler({ durationMs: 60 * MIN, maxBars: 4 })
    );
  });

  it('treats a non-finite elapsed time as zero', () => {
    expect(fillsOf(computeRuler({ durationMs: 25 * MIN, elapsedMs: Number.NaN }))).toEqual(
      Array(25).fill(0)
    );
  });

  it('does not read the clock or the DOM', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/core/ruler.js'), 'utf8');
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/\bperformance\b/);
    expect(source).not.toMatch(/\bdocument\b/);
    expect(source).not.toMatch(/\bwindow\b/);
  });
});

describe('ruler properties', () => {
  const duration = fc.integer({ min: 0, max: 180 * MIN });
  const elapsed = fc.integer({ min: -10 * MIN, max: 200 * MIN });

  it('keeps the count between 1 and the budget, every fill in range, and the fills honest', () => {
    fc.assert(
      fc.property(duration, elapsed, (durationMs, elapsedMs) => {
        const ruler = computeRuler({ durationMs, elapsedMs });
        expect(ruler.count).toBeGreaterThanOrEqual(1);
        expect(ruler.count).toBeLessThanOrEqual(MAX_BARS);
        expect(ruler.bars).toHaveLength(ruler.count);
        const total = ruler.bars.reduce((sum, bar) => sum + bar.fill, 0);
        for (const bar of ruler.bars) {
          expect(bar.fill).toBeGreaterThanOrEqual(0);
          expect(bar.fill).toBeLessThanOrEqual(1);
        }
        const capped = Math.min(Math.max(elapsedMs, 0), durationMs);
        expect(Math.abs(total - capped / ruler.unitMs)).toBeLessThan(1e-9);
      }),
      { numRuns: 300 }
    );
  });
});
