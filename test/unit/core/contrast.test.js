import { describe, expect, it } from 'vitest';
import {
  GLASS_BASE,
  LABEL_COLOR,
  MIN_CONTRAST,
  contrastRatio,
  parseColor,
  themeContrast,
} from '../../../src/core/contrast.js';
import { themeNames } from '../../../src/core/themes.js';

describe('contrastRatio', () => {
  it('is 21:1 for black on white and 1:1 for a colour against itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#08090d', '#08090d')).toBe(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#ff8800', '#101820')).toBeCloseTo(
      contrastRatio('#101820', '#ff8800'),
      10
    );
  });

  it('composites a translucent foreground over the background', () => {
    expect(contrastRatio('rgba(255, 255, 255, .5)', GLASS_BASE)).toBeCloseTo(
      contrastRatio('rgba(255,255,255,0.5)', GLASS_BASE),
      10
    );
    expect(contrastRatio('rgba(255, 255, 255, .5)', GLASS_BASE)).toBeLessThan(
      contrastRatio('#ffffff', GLASS_BASE)
    );
  });

  it('rejects colours it cannot parse', () => {
    expect(() => contrastRatio('chartreuse-ish', '#000')).toThrow(/unsupported colour/);
  });
});

describe('parseColor', () => {
  it('reads short and long hex, with and without alpha', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#08090d')).toEqual({ r: 8, g: 9, b: 13, a: 1 });
    expect(parseColor('#00000080').a).toBeCloseTo(128 / 255, 10);
    expect(parseColor('#0008').a).toBeCloseTo(136 / 255, 10);
  });

  it('reads legacy comma and modern slash rgb syntax', () => {
    expect(parseColor('rgba(255, 255, 255, .5)')).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 0.5,
    });
    expect(parseColor('rgb(255 255 255 / 50%)')).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 0.5,
    });
    expect(parseColor('rgba(1, 2, 3, 0.25)')).toEqual({ r: 1, g: 2, b: 3, a: 0.25 });
    expect(parseColor('rgb(100% 50% 0%)')).toEqual({ r: 255, g: 127.5, b: 0, a: 1 });
  });

  it('treats unreadable hex digits as zero rather than NaN', () => {
    expect(parseColor('#gg0000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('reads oklch into an in-gamut sRGB triple', () => {
    const white = parseColor('oklch(1 0 0)');
    expect(white.r).toBeCloseTo(255, 3);
    expect(white.g).toBeCloseTo(255, 3);
    expect(white.b).toBeCloseTo(255, 3);
    expect(parseColor('oklch(.79 .16 255 / .8)').a).toBeCloseTo(0.8, 10);
  });
});

describe('themeContrast', () => {
  it('passes the 4.5:1 floor for every theme, naming the failing pair', () => {
    for (const theme of themeNames()) {
      const result = themeContrast(theme);
      const worst = result.pairs.reduce((low, entry) => (entry.ratio < low.ratio ? entry : low));
      expect(
        result.minimum,
        `${theme}: ${worst.pair} is ${worst.ratio.toFixed(2)}:1 (${worst.fg} on ${worst.bg})`
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(result.pass, `${theme} should pass`).toBe(true);
    }
  });

  it('samples the whole focus accent and the dimmest label', () => {
    const result = themeContrast('dusk');
    expect(result.pairs.filter((entry) => entry.pair.startsWith('digits['))).toHaveLength(11);
    expect(result.pairs).toContainEqual(
      expect.objectContaining({ pair: 'labels', fg: LABEL_COLOR, bg: GLASS_BASE })
    );
  });

  it('falls back to dusk for an unknown theme', () => {
    expect(themeContrast('neon').theme).toBe('Dusk');
  });
});
