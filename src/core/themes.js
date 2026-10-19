/**
 * The built-in themes and the color a bar receives in each phase
 * (capability: theme-palette).
 *
 * Each theme interpolates from (h0, L0, C0) to (h1, L1, C1) across the focus
 * bars, so the ruler shifts as the session drains. Pure module: no DOM, no
 * clock, no state.
 */

/**
 * @typedef {object} Palette
 * @property {string} name label for the settings picker
 * @property {number} h0 hue of the first focus bar, in oklch degrees
 * @property {number} h1 hue of the last focus bar
 * @property {number} L0 lightness of the first focus bar
 * @property {number} L1 lightness of the last focus bar
 * @property {number} C0 chroma of the first focus bar
 * @property {number} C1 chroma of the last focus bar
 */

/** @type {Readonly<Record<string, Readonly<Palette>>>} */
export const THEMES = Object.freeze({
  dusk: Object.freeze({ name: 'Dusk', h0: 255, h1: 385, L0: 0.79, L1: 0.75, C0: 0.16, C1: 0.19 }),
  tide: Object.freeze({ name: 'Tide', h0: 245, h1: 170, L0: 0.78, L1: 0.86, C0: 0.14, C1: 0.14 }),
  solar: Object.freeze({ name: 'Solar', h0: 95, h1: 25, L0: 0.88, L1: 0.74, C0: 0.15, C1: 0.19 }),
  mono: Object.freeze({ name: 'Mono', h0: 0, h1: 0, L0: 0.6, L1: 0.98, C0: 0, C1: 0 }),
});

/**
 * The theme ids, in the order the settings picker shows them.
 *
 * @returns {string[]}
 */
export function themeNames() {
  return Object.keys(THEMES);
}

/**
 * Look up a palette, falling back to `dusk` for anything unknown so a stale
 * settings file can never break the renderer.
 *
 * @param {string} name
 * @returns {Readonly<Palette>}
 */
export function resolveTheme(name) {
  return THEMES[name] || THEMES.dusk;
}

/**
 * The color of one bar, as an `oklch()` string. The focus phase walks the
 * theme's full interpolation; break phases use their own fixed pair, and the
 * mono theme stays greyscale.
 *
 * @param {string} theme theme id; unknown ids fall back to `dusk`
 * @param {string} phase 'focus', 'short' or 'long'
 * @param {number} index bar position, 0-based
 * @param {number} count number of bars in the ruler
 * @returns {string}
 */
export function barColor(theme, phase, index, count) {
  const t = count > 1 ? index / (count - 1) : 0;
  const palette = resolveTheme(theme);
  if (phase === 'focus') {
    const L = palette.L0 + (palette.L1 - palette.L0) * t;
    const C = palette.C0 + (palette.C1 - palette.C0) * t;
    const h = palette.h0 + (palette.h1 - palette.h0) * t;
    return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)})`;
  }
  if (theme === 'mono') return 'oklch(.9 0 0)';
  return phase === 'short' ? `oklch(.86 .115 ${172 + 40 * t})` : `oklch(.84 .12 ${205 + 35 * t})`;
}
