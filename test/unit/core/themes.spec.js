import { describe, expect, it } from 'vitest';
import { THEMES, barColor, resolveTheme, themeNames } from '../../../src/core/themes.js';

const PHASES = ['focus', 'short', 'long'];
const COUNTS = [1, 2, 7, 15, 25, 30];

const parse = (color) => {
  const match = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)$/.exec(color);
  if (!match) throw new Error(`not an oklch() color: ${color}`);
  const [L, C, h] = match.slice(1).map(Number);
  return { L, C, h };
};

describe('themes', () => {
  it('ships exactly four themes with a palette each', () => {
    expect(themeNames()).toEqual(['dusk', 'tide', 'solar', 'mono']);
    expect(themeNames()).toEqual(Object.keys(THEMES));
    for (const id of themeNames()) {
      const palette = resolveTheme(id);
      expect(palette.name).toBeTruthy();
      for (const key of ['h0', 'h1', 'L0', 'L1', 'C0', 'C1'])
        expect(typeof palette[key]).toBe('number');
    }
  });

  it('falls back to dusk for an unknown theme', () => {
    expect(resolveTheme('neon')).toBe(THEMES.dusk);
  });

  it('keeps mono achromatic and its lightness range wide', () => {
    const mono = resolveTheme('mono');
    expect(mono.C0).toBe(0);
    expect(mono.C1).toBe(0);
    expect(mono.L1 - mono.L0).toBeGreaterThanOrEqual(0.25);
  });
});

describe('barColor', () => {
  it('returns a valid oklch() string for every bar of every phase', () => {
    for (const theme of themeNames()) {
      for (const phase of PHASES) {
        for (const count of COUNTS) {
          for (let index = 0; index < count; index++) {
            const color = barColor(theme, phase, index, count);
            expect(() => parse(color)).not.toThrow();
          }
        }
      }
    }
  });

  it('makes the first and last bar differ, the last one using the second color', () => {
    for (const theme of themeNames()) {
      const palette = resolveTheme(theme);
      const first = barColor(theme, 'focus', 0, 25);
      const last = barColor(theme, 'focus', 24, 25);
      expect(last).not.toBe(first);
      const lastColor = parse(last);
      expect(lastColor.L).toBeCloseTo(palette.L1, 2);
      expect(lastColor.C).toBeCloseTo(palette.C1, 2);
      expect(lastColor.h).toBeCloseTo(palette.h1, 0);
      const firstColor = parse(first);
      expect(firstColor.L).toBeCloseTo(palette.L0, 2);
      expect(firstColor.C).toBeCloseTo(palette.C0, 2);
      expect(firstColor.h).toBeCloseTo(palette.h0, 0);
    }
  });

  it('draws focus and break bars from different color pairs', () => {
    for (const theme of themeNames()) {
      const focus = parse(barColor(theme, 'focus', 0, 25));
      const short = parse(barColor(theme, 'short', 0, 25));
      const long = parse(barColor(theme, 'long', 0, 25));
      expect(short).not.toEqual(focus);
      expect(long).not.toEqual(focus);
      // mono is greyscale, so its two break phases intentionally share a color
      if (theme !== 'mono') expect(short).not.toEqual(long);
    }
  });

  it('falls back to dusk colors for an unknown theme', () => {
    expect(barColor('neon', 'focus', 3, 25)).toBe(barColor('dusk', 'focus', 3, 25));
  });
});

describe('legibility floor', () => {
  it('keeps every bar color at lightness 0.45 or above', () => {
    for (const theme of themeNames()) {
      for (const phase of PHASES) {
        for (const count of COUNTS) {
          for (let index = 0; index < count; index++) {
            const { L } = parse(barColor(theme, phase, index, count));
            expect(L).toBeGreaterThanOrEqual(0.45);
          }
        }
      }
    }
  });
});
