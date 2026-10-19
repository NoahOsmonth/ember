/**
 * WCAG contrast arithmetic for the theme tokens.
 *
 * The renderer paints oklch() accents on a near-black glass. Eyeballing those
 * colours does not survive a theme edit, so the floor is computed here from the
 * same tokens the renderer uses. Pure module: no DOM, no clock, no state.
 */

import { barColor, resolveTheme } from './themes.js';

/** WCAG AA floor for normal-size text. */
export const MIN_CONTRAST = 4.5;

/** The opaque glass base the solid fallback paints. */
export const GLASS_BASE = '#08090d';

/** The dimmest label colour the widget uses (`.note`). */
export const LABEL_COLOR = 'rgba(255, 255, 255, .5)';

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const readAlpha = (part) => {
  const text = String(part).trim();
  const value = Number.parseFloat(text);
  return text.endsWith('%') ? clamp(value / 100) : clamp(value);
};

/**
 * @typedef {{ r: number, g: number, b: number, a: number }} Rgba
 */

/**
 * @param {string} text
 * @returns {Rgba}
 */
function parseHex(text) {
  const hex = text.slice(1);
  const short = hex.length === 3 || hex.length === 4;
  const step = short ? 1 : 2;
  const channel = (index) => {
    const part = hex.slice(index * step, index * step + step);
    const value = Number.parseInt(short ? part + part : part, 16);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    a: hex.length === 4 ? channel(3) / 255 : hex.length === 8 ? channel(3) / 255 : 1,
  };
}

/**
 * @param {string} text
 * @returns {Rgba}
 */
function parseRgb(text) {
  const body = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
  const [channels, alpha] = body.split('/');
  const parts = channels
    .trim()
    .split(/\s*,\s*|\s+/)
    .filter(Boolean);
  const read = (part) => {
    const value = Number.parseFloat(part);
    return part.endsWith('%') ? (value / 100) * 255 : value;
  };
  return {
    r: read(parts[0]),
    g: read(parts[1]),
    b: read(parts[2]),
    a: alpha !== undefined ? readAlpha(alpha) : parts.length > 3 ? readAlpha(parts[3]) : 1,
  };
}

/** Linear-light sRGB from an oklch triple. */
function oklchToLinear(L, C, h) {
  const radians = (h * Math.PI) / 180;
  const a = C * Math.cos(radians);
  const b = C * Math.sin(radians);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const encode = (linear) => {
  const value = clamp(linear);
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
};

/**
 * @param {string} text
 * @returns {Rgba}
 */
function parseOklch(text) {
  const body = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
  const [channels, alpha] = body.split('/');
  const parts = channels.trim().split(/\s+/).filter(Boolean);
  const L = Number.parseFloat(parts[0]);
  const C = Number.parseFloat(parts[1]);
  const h = Number.parseFloat(parts[2]);
  const [r, g, b] = oklchToLinear(L, C, h);
  return {
    r: encode(r) * 255,
    g: encode(g) * 255,
    b: encode(b) * 255,
    a: alpha === undefined ? 1 : readAlpha(alpha),
  };
}

/**
 * Parse the CSS colour forms the theme table emits.
 *
 * @param {string} color
 * @returns {Rgba}
 */
export function parseColor(color) {
  const text = String(color).trim().toLowerCase();
  if (text.startsWith('#')) return parseHex(text);
  if (text.startsWith('oklch(')) return parseOklch(text);
  if (text.startsWith('rgb')) return parseRgb(text);
  throw new TypeError(`unsupported colour: ${color}`);
}

/** WCAG relative luminance from 8-bit sRGB channels. */
function luminance({ r, g, b }) {
  const channel = (value) => {
    const srgb = clamp(value / 255);
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Paint a translucent foreground over an opaque background. */
function composite(fg, bg) {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

/**
 * WCAG contrast ratio between two colours. A translucent foreground is
 * composited over the background first, which is what the glass does.
 *
 * @param {string} foreground
 * @param {string} background
 * @returns {number} ratio in the range 1..21
 */
export function contrastRatio(foreground, background) {
  const bg = parseColor(background);
  const fg = composite(parseColor(foreground), bg);
  const lighter = Math.max(luminance(fg), luminance(bg));
  const darker = Math.min(luminance(fg), luminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Every text pair a theme owns, measured against the opaque glass base.
 *
 * The focus accent walks the palette, so every step is sampled; a theme that
 * only fails at one end is still a failure.
 *
 * @param {string} name theme id; unknown ids fall back to `dusk`
 * @returns {{ theme: string, minimum: number, pass: boolean, pairs: Array<{ pair: string, fg: string, bg: string, ratio: number }> }}
 */
export function themeContrast(name) {
  const palette = resolveTheme(name);
  const pairs = [];
  for (let index = 0; index <= 10; index += 1) {
    const fg = barColor(name, 'focus', index, 11);
    pairs.push({
      pair: `digits[${index}]`,
      fg,
      bg: GLASS_BASE,
      ratio: contrastRatio(fg, GLASS_BASE),
    });
  }
  pairs.push({
    pair: 'labels',
    fg: LABEL_COLOR,
    bg: GLASS_BASE,
    ratio: contrastRatio(LABEL_COLOR, GLASS_BASE),
  });
  const minimum = Math.min(...pairs.map((entry) => entry.ratio));
  return { theme: palette.name, minimum, pass: minimum >= MIN_CONTRAST, pairs };
}
